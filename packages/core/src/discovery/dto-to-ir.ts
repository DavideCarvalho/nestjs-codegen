/**
 * Pure-AST translation of class-validator-decorated DTO classes into the neutral
 * {@link SchemaModule} IR. Reads decorator names + literal args via ts-morph — it
 * never imports class-validator at runtime. A `ValidationAdapter` renders the IR.
 *
 * This is the sole DTO translator: it emits neutral `SchemaNode` IR (replacing
 * the former `dto-to-zod.ts` text path). A `ValidationAdapter` renders the IR;
 * the bundled zod adapter reproduces the original zod-text output byte-for-byte.
 */
import {
  type ClassDeclaration,
  type Decorator,
  Node,
  type Project,
  type PropertyDeclaration,
  type SourceFile,
} from 'ts-morph';
import type { NumberCheck, SchemaModule, SchemaNode, StringCheck } from '../ir/schema-node.js';
import { findType } from './type-ref-resolution.js';

interface BuildContext {
  sourceFile: SourceFile;
  project: Project;
  named: Map<string, SchemaNode>;
  warnings: string[];
  warnedDecorators: Set<string>;
  emittedClasses: Map<string, string>;
  visiting: Set<string>;
  recursiveSchemas: Set<string>;
  depth: number;
}

const KNOWN_DECORATORS = new Set([
  'IsString',
  'IsNumber',
  'IsInt',
  'IsBoolean',
  'IsDate',
  'IsEmail',
  'IsUrl',
  'IsUUID',
  'MinLength',
  'MaxLength',
  'Length',
  'Min',
  'Max',
  'IsPositive',
  'IsNegative',
  'Matches',
  'IsEnum',
  'IsIn',
  'IsOptional',
  'IsNotEmpty',
  'IsArray',
  'ValidateNested',
  'Type',
  'IsObject',
  'Allow',
  'IsDefined',
]);

export function extractSchemaFromDto(
  classDecl: ClassDeclaration,
  sourceFile: SourceFile,
  project: Project,
): SchemaModule {
  const ctx: BuildContext = {
    sourceFile,
    project,
    named: new Map(),
    warnings: [],
    warnedDecorators: new Set(),
    emittedClasses: new Map(),
    visiting: new Set(),
    recursiveSchemas: new Set(),
    depth: 0,
  };
  const root = buildObject(classDecl, sourceFile, ctx);
  // Recursive named schemas keep their real (self-referential) shape; the
  // recursion site carries a `lazyRef` back-edge. Each adapter breaks the
  // TypeScript inference cycle in its own way (annotated const + hoisted
  // structural type for zod/valibot, `this` for arktype). The set of genuinely
  // recursive names is surfaced so adapters know which consts need that.
  return { root, named: ctx.named, warnings: ctx.warnings, recursive: ctx.recursiveSchemas };
}

// ---------------------------------------------------------------------------
// Object builder
// ---------------------------------------------------------------------------

function buildObject(
  classDecl: ClassDeclaration,
  classFile: SourceFile,
  ctx: BuildContext,
): SchemaNode {
  const props = classDecl.getProperties();
  if (props.length === 0) {
    return { kind: 'object', fields: [], passthrough: true };
  }
  const fields: Array<{ key: string; value: SchemaNode }> = [];
  for (const prop of props) {
    fields.push({ key: prop.getName(), value: buildProperty(prop, classFile, ctx) });
  }
  return { kind: 'object', fields, passthrough: false };
}

// ---------------------------------------------------------------------------
// Property builder — the §2.2 mapping table lives here.
// ---------------------------------------------------------------------------

function buildProperty(
  prop: PropertyDeclaration,
  classFile: SourceFile,
  ctx: BuildContext,
): SchemaNode {
  const decorators = new Map<string, Decorator>();
  for (const d of prop.getDecorators()) decorators.set(d.getName(), d);
  const has = (n: string): boolean => decorators.has(n);
  const dec = (n: string): Decorator | undefined => decorators.get(n);

  const typeNode = prop.getTypeNode();
  const typeText = typeNode?.getText() ?? 'unknown';
  // Detect arrays from the AST, not the text: a union like `unknown | unknown[]`
  // ends in "[]" but is NOT an array type.
  const isArrayType = !!typeNode && Node.isArrayTypeNode(typeNode);

  // ── Nested / array-of-nested via @ValidateNested + @Type ────────────────
  const typeRefName = resolveTypeFactoryName(dec('Type'));
  if (has('ValidateNested') || typeRefName) {
    const childName = typeRefName ?? singularClassName(typeText);
    if (childName) {
      const childNode = buildNestedReference(childName, classFile, ctx);
      const wrapArray = has('IsArray') || isArrayType;
      const node: SchemaNode = wrapArray ? { kind: 'array', element: childNode } : childNode;
      return applyPresence(node, decorators);
    }
  }

  // ── Base type (TS property type), then decorator refinements ────────────
  let base = baseFromType(typeText, isArrayType);
  const stringChecks: StringCheck[] = [];
  const numberChecks: NumberCheck[] = [];

  // Type overrides
  if (has('IsString')) base = { kind: 'string', checks: stringChecks };
  if (has('IsBoolean')) base = { kind: 'boolean' };
  if (has('IsDate')) base = { kind: 'date' };
  if (has('IsNumber')) base = { kind: 'number', checks: numberChecks };
  if (has('IsInt')) {
    base = { kind: 'number', checks: numberChecks };
    numberChecks.push({ check: 'int' });
  }
  if (has('IsObject') && !has('ValidateNested')) {
    base = { kind: 'object', fields: [], passthrough: true };
  }
  if (has('Allow')) base = { kind: 'unknown' };

  const ensureString = (): void => {
    if (base.kind !== 'string') base = { kind: 'string', checks: stringChecks };
  };

  // String format refinements (these also imply string base).
  if (has('IsEmail')) {
    ensureString();
    const m = messageRaw(dec('IsEmail'));
    stringChecks.push(m === undefined ? { check: 'email' } : { check: 'email', messageRaw: m });
  }
  if (has('IsUrl')) {
    ensureString();
    const m = messageRaw(dec('IsUrl'));
    stringChecks.push(m === undefined ? { check: 'url' } : { check: 'url', messageRaw: m });
  }
  if (has('IsUUID')) {
    ensureString();
    const m = messageRaw(dec('IsUUID'));
    stringChecks.push(m === undefined ? { check: 'uuid' } : { check: 'uuid', messageRaw: m });
  }
  if (has('Matches')) {
    const re = firstArgText(dec('Matches'));
    if (re) {
      ensureString();
      stringChecks.push({ check: 'regex', pattern: re });
    }
  }

  // Length / size refinements
  if (has('MinLength')) {
    const n = numericArg(dec('MinLength'));
    if (n !== null) stringChecks.push({ check: 'min', value: n });
  }
  if (has('MaxLength')) {
    const n = numericArg(dec('MaxLength'));
    if (n !== null) stringChecks.push({ check: 'max', value: n });
  }
  if (has('Length')) {
    const [min, max] = numericArgs(dec('Length'));
    if (min !== null) stringChecks.push({ check: 'min', value: min });
    if (max !== null) stringChecks.push({ check: 'max', value: max });
  }
  if (has('Min')) {
    const n = numericArg(dec('Min'));
    if (n !== null) numberChecks.push({ check: 'min', value: n });
  }
  if (has('Max')) {
    const n = numericArg(dec('Max'));
    if (n !== null) numberChecks.push({ check: 'max', value: n });
  }
  if (has('IsPositive')) numberChecks.push({ check: 'positive' });
  if (has('IsNegative')) numberChecks.push({ check: 'negative' });
  if (has('IsNotEmpty') && base.kind === 'string') stringChecks.push({ check: 'min', value: '1' });

  // Enum / membership (replaces base).
  if (has('IsEnum')) {
    const enumNode = enumSchemaFromDecorator(dec('IsEnum'), classFile, ctx);
    if (enumNode) base = enumNode;
  }
  if (has('IsIn')) {
    const inNode = inSchemaFromDecorator(dec('IsIn'));
    if (inNode) base = inNode;
  }

  // ── Unmappable decorators → warn + comment, keep base ───────────────────
  const unmappable: string[] = [];
  for (const name of decorators.keys()) {
    if (!KNOWN_DECORATORS.has(name)) {
      unmappable.push(name);
      if (!ctx.warnedDecorators.has(name)) {
        ctx.warnedDecorators.add(name);
        const msg = `@${name} is not translatable to a client validation schema and was skipped (server-only validation).`;
        ctx.warnings.push(msg);
        console.warn(`[nestjs-codegen] ${msg}`);
      }
    }
  }

  // Attach the collected refinements to the base. `base` may have been created
  // by `baseFromType` (with its own empty checks array) or by an override, so
  // rebuild it here to guarantee the accumulated checks are the ones emitted.
  if (base.kind === 'string') base = { kind: 'string', checks: stringChecks };
  else if (base.kind === 'number') base = { kind: 'number', checks: numberChecks };

  let node: SchemaNode = base;

  // Array wrapping when the TS type is `T[]` and no nested handling occurred.
  if (isArrayType && node.kind !== 'array') {
    node = { kind: 'array', element: node };
  }

  node = applyPresence(node, decorators);

  if (unmappable.length > 0) {
    node = { kind: 'annotated', inner: node, unmappable };
  }
  return node;
}

/** `.optional()` / required handling from @IsOptional / @IsDefined. */
function applyPresence(node: SchemaNode, decorators: Map<string, Decorator>): SchemaNode {
  if (decorators.has('IsDefined')) return node; // explicitly required
  if (decorators.has('IsOptional')) return { kind: 'optional', inner: node };
  return node;
}

// ---------------------------------------------------------------------------
// Base type from the TS property type
// ---------------------------------------------------------------------------

function baseFromType(typeText: string, isArrayType: boolean): SchemaNode {
  const inner = isArrayType ? typeText.slice(0, -2).trim() : typeText;
  switch (inner) {
    case 'string':
      return { kind: 'string', checks: [] };
    case 'number':
      return { kind: 'number', checks: [] };
    case 'boolean':
      return { kind: 'boolean' };
    case 'Date':
      return { kind: 'date' };
    case 'File':
    case 'Express.Multer.File':
      return { kind: 'instanceof', ctor: 'File' };
    default:
      return { kind: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Nested DTO references (hoisted named consts)
// ---------------------------------------------------------------------------

function buildNestedReference(
  className: string,
  fromFile: SourceFile,
  ctx: BuildContext,
): SchemaNode {
  // Genuine recursion guard FIRST: the class is already on the build stack, so
  // this is a self/mutual reference. Emit a `lazyRef` back-edge to the named
  // schema reserved by the outer frame and mark it recursive — adapters keep the
  // real shape and break the inference cycle themselves.
  if (ctx.visiting.has(className)) {
    const reserved = ctx.emittedClasses.get(className) ?? aliasFor(className, ctx);
    ctx.emittedClasses.set(className, reserved);
    ctx.recursiveSchemas.add(reserved);
    if (!ctx.warnedDecorators.has(`recursive:${reserved}`)) {
      ctx.warnedDecorators.add(`recursive:${reserved}`);
      const msg = `${className} is a recursive type; the generated schema validates it via a lazy self-reference.`;
      ctx.warnings.push(msg);
      console.warn(`[nestjs-codegen] ${msg}`);
    }
    return { kind: 'lazyRef', name: reserved };
  }

  // Depth cap: not recursive, just nested deeper than we expand. Degrade this
  // branch to `unknown` inline (no named schema, not flagged as recursive).
  if (ctx.depth >= 8) {
    if (!ctx.warnedDecorators.has(`deep:${className}`)) {
      ctx.warnedDecorators.add(`deep:${className}`);
      const msg = `${className} nesting is too deep to expand; the generated schema uses unknown for it.`;
      ctx.warnings.push(msg);
      console.warn(`[nestjs-codegen] ${msg}`);
    }
    return { kind: 'unknown', note: 'nesting too deep — not expanded' };
  }

  const existing = ctx.emittedClasses.get(className);
  if (existing) return { kind: 'ref', name: existing };

  const schemaName = aliasFor(className, ctx);
  const resolved = findType(className, fromFile, ctx.project);
  if (!resolved || resolved.kind !== 'class') {
    return { kind: 'object', fields: [], passthrough: true };
  }

  ctx.emittedClasses.set(className, schemaName);
  ctx.visiting.add(className);
  ctx.depth += 1;
  const childNode = buildObject(resolved.decl, resolved.file, ctx);
  ctx.depth -= 1;
  ctx.visiting.delete(className);

  ctx.named.set(schemaName, childNode);
  return { kind: 'ref', name: schemaName };
}

function aliasFor(className: string, ctx: BuildContext): string {
  const baseName = `${className}Schema`;
  let candidate = baseName;
  let i = 1;
  const used = new Set(ctx.named.keys());
  for (const v of ctx.emittedClasses.values()) used.add(v);
  while (used.has(candidate)) {
    candidate = `${baseName}_${i}`;
    i += 1;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Decorator argument readers (pure AST)
// ---------------------------------------------------------------------------

function firstArg(decorator: Decorator | undefined): Node | undefined {
  return decorator?.getArguments()[0];
}

function firstArgText(decorator: Decorator | undefined): string | null {
  const arg = firstArg(decorator);
  return arg ? arg.getText() : null;
}

function numericArg(decorator: Decorator | undefined): string | null {
  const arg = firstArg(decorator);
  if (arg && Node.isNumericLiteral(arg)) return arg.getText();
  return null;
}

function numericArgs(decorator: Decorator | undefined): [string | null, string | null] {
  const args = decorator?.getArguments() ?? [];
  const num = (n: Node | undefined): string | null =>
    n && Node.isNumericLiteral(n) ? n.getText() : null;
  return [num(args[0]), num(args[1])];
}

/** Reads a `{ message: '...' }` options object → the verbatim message literal text. */
function messageRaw(decorator: Decorator | undefined): string | undefined {
  const args = decorator?.getArguments() ?? [];
  for (const arg of args) {
    if (Node.isObjectLiteralExpression(arg)) {
      for (const prop of arg.getProperties()) {
        if (Node.isPropertyAssignment(prop) && prop.getName() === 'message') {
          const init = prop.getInitializer();
          if (init && Node.isStringLiteral(init)) return init.getText();
        }
      }
    }
  }
  return undefined;
}

/** Resolve `@Type(() => Child)` → `'Child'`. */
function resolveTypeFactoryName(decorator: Decorator | undefined): string | null {
  const arg = firstArg(decorator);
  if (!arg) return null;
  if (Node.isArrowFunction(arg)) {
    const body = arg.getBody();
    if (Node.isIdentifier(body)) return body.getText();
  }
  return null;
}

/** Drop array suffix from a type text → class name (`Child[]` → `Child`). */
function singularClassName(typeText: string): string | null {
  const inner = typeText.endsWith('[]') ? typeText.slice(0, -2).trim() : typeText;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(inner) ? inner : null;
}

/** `@IsEnum(E)` → enum node (or verbatim fallback when unresolvable). */
function enumSchemaFromDecorator(
  decorator: Decorator | undefined,
  classFile: SourceFile,
  ctx: BuildContext,
): SchemaNode | null {
  const arg = firstArg(decorator);
  if (!arg) return null;
  if (Node.isIdentifier(arg)) {
    const name = arg.getText();
    const resolved = findType(name, classFile, ctx.project);
    if (resolved && resolved.kind === 'enum') {
      return { kind: 'enum', literals: resolved.members };
    }
    const msg = `@IsEnum(${name}): enum could not be resolved to literal members and is not importable into the generated schema; falling back to unknown.`;
    if (!ctx.warnedDecorators.has(`IsEnum:${name}`)) {
      ctx.warnedDecorators.add(`IsEnum:${name}`);
      ctx.warnings.push(msg);
      console.warn(`[nestjs-codegen] ${msg}`);
    }
    return { kind: 'unknown', note: `@IsEnum(${name}): enum not resolvable to literals` };
  }
  if (Node.isObjectLiteralExpression(arg)) {
    const values: string[] = [];
    for (const p of arg.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue;
      const init = p.getInitializer();
      if (init && Node.isStringLiteral(init)) values.push(init.getText());
    }
    if (values.length > 0) return { kind: 'enum', literals: values };
  }
  return null;
}

/** `@IsIn(['a','b'])` → enum node; non-string members → union of literals. */
function inSchemaFromDecorator(decorator: Decorator | undefined): SchemaNode | null {
  const arg = firstArg(decorator);
  if (arg && Node.isArrayLiteralExpression(arg)) {
    const elements = arg.getElements();
    const allStrings = elements.every((e) => Node.isStringLiteral(e));
    if (allStrings && elements.length > 0) {
      return { kind: 'enum', literals: elements.map((e) => e.getText()) };
    }
    if (elements.length > 0) {
      return {
        kind: 'union',
        options: elements.map((e) => ({ kind: 'literal', raw: e.getText() })),
      };
    }
  }
  return null;
}
