import {
  type Node,
  type Project,
  type SourceFile,
  type Symbol as TsSymbol,
  type Type,
  ts,
} from 'ts-morph';
import { SchemaTypeProgram } from './schema-type-program.js';
import { dbg } from './type-ref-resolution.js';

/**
 * Type-checker inference for validation schemas (zod, valibot, arktype, …).
 *
 * The rest of discovery reads source syntactically, which is what makes it fast —
 * and what made a schema like `z.string().email().max(80)` degrade to `unknown`:
 * the hand-written zod walker ({@link import('./zod-ast-to-ts.js').zodAstToTs})
 * only knows a fixed list of calls, and every refinement, transform, default or
 * library-specific method sits outside it. Walking the chain can never be complete,
 * so this module asks the TypeScript checker instead — the same inference that
 * types the handler's `z.infer<typeof schema>` parameter.
 *
 * It is library-agnostic by construction: a schema is recognized by the Standard
 * Schema property (`'~standard'`, implemented by zod >= 3.24, valibot >= 1 and
 * arktype >= 2), whose `types` member carries the schema's input and output types.
 * Older zod, which predates Standard Schema, is read through its `_input`/`_output`
 * phantom properties.
 *
 * Which of the two types is used depends on the position:
 *
 *  - request (body / query / params) → the INPUT type: the generated client sends
 *    what the schema ACCEPTS, before defaults and transforms run. A field with a
 *    `.default()` is therefore optional, and `.transform()` is typed by what it
 *    reads, not what it produces (sending the produced value would be rejected).
 *    Where the input is `unknown` — zod 4's `z.coerce.*()` accepts anything — the
 *    output type is used instead, so a `z.coerce.number()` query param is `number`.
 *  - response / error → the OUTPUT type: what the server sends back.
 */

/** The input/output types a schema expression carries, resolved at the expression. */
export interface SchemaTypes {
  input: Type;
  output: Type;
  /** The node in the typed project the types were resolved at. */
  at: Node;
}

/** Outcome of asking whether an expression is a schema. */
export type SchemaInference =
  | { kind: 'schema'; types: SchemaTypes }
  /** The checker typed the expression and it is not a schema (a plain pipe option, an enum, …). */
  | { kind: 'not-schema' }
  /** The checker could not type the expression (unresolved import, no typed project). */
  | { kind: 'unresolved' };

// ---------------------------------------------------------------------------
// The typed program
// ---------------------------------------------------------------------------

/**
 * One {@link SchemaTypeProgram} per discovery Project, built lazily — only when a
 * route actually carries a schema candidate — so a codebase without schemas never
 * pays for it.
 */
const programs = new WeakMap<Project, SchemaTypeProgram>();

function programFor(discovery: Project): SchemaTypeProgram {
  let program = programs.get(discovery);
  if (!program) {
    program = new SchemaTypeProgram(discovery);
    programs.set(discovery, program);
  }
  return program;
}

/**
 * Drop the typed program built for `discovery`, so the next inference re-reads the
 * files. The watcher reuses one discovery Project across changes and calls this on
 * every pass; the cold path calls it once extraction is done.
 */
export function clearSchemaTypeProject(discovery: Project): void {
  programs.delete(discovery);
}

/** The node in `typedSf` that spans exactly what `node` spans in the discovery file. */
function counterpart(typedSf: SourceFile, node: Node): Node | undefined {
  const start = node.getStart();
  const end = node.getEnd();
  const kind = node.getKind();
  let candidate: Node | undefined = typedSf.getDescendantAtPos(start);
  while (candidate) {
    if (
      candidate.getStart() === start &&
      candidate.getEnd() === end &&
      candidate.getKind() === kind
    ) {
      return candidate;
    }
    if (candidate.getStart() < start || candidate.getEnd() > end) return undefined;
    candidate = candidate.getParent();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Schema recognition
// ---------------------------------------------------------------------------

/** A property's type as seen from `at` (mapped and generic members have no declaration of their own). */
function propType(type: Type, name: string, at: Node): Type | undefined {
  return type.getProperty(name)?.getTypeAtLocation(at);
}

function isAnyOrUnknown(type: Type): boolean {
  return type.isAny() || type.isUnknown();
}

/**
 * Read the input/output types off a schema expression. See {@link SchemaInference}
 * for the three outcomes. Never throws: a checker failure is `unresolved`, which
 * callers treat the same as a missing schema library.
 */
export function inferSchema(expr: Node, discovery: Project): SchemaInference {
  try {
    const typedSf = programFor(discovery).sourceFileFor(expr.getSourceFile());
    const at = typedSf && counterpart(typedSf, expr);
    if (!at) return { kind: 'unresolved' };

    const schemaType = at.getType();
    if (isAnyOrUnknown(schemaType)) return { kind: 'unresolved' };

    // Standard Schema (zod >= 3.24, valibot >= 1, arktype >= 2).
    const standard = propType(schemaType, '~standard', at);
    const stdTypes = standard ? propType(standard, 'types', at)?.getNonNullableType() : undefined;
    const stdInput = stdTypes ? propType(stdTypes, 'input', at) : undefined;
    const stdOutput = stdTypes ? propType(stdTypes, 'output', at) : undefined;
    if (stdInput && stdOutput) {
      return { kind: 'schema', types: { input: stdInput, output: stdOutput, at } };
    }

    // zod before Standard Schema: the `_input`/`_output` phantom properties.
    const zodInput = propType(schemaType, '_input', at);
    const zodOutput = propType(schemaType, '_output', at);
    if (zodInput && zodOutput) {
      return { kind: 'schema', types: { input: zodInput, output: zodOutput, at } };
    }
    return { kind: 'not-schema' };
  } catch (err) {
    dbg('schema inference failed:', err);
    return { kind: 'unresolved' };
  }
}

// ---------------------------------------------------------------------------
// Rendering a checker Type as a client-safe type expression
// ---------------------------------------------------------------------------

/**
 * Built-in types that are emitted by NAME: they are globals in any TS program, so
 * the generated file can reference them without an import. Anything else declared
 * in a `.d.ts` is a library class/interface whose name the generated file cannot
 * see, and whose methods have no place in a request type — it renders as `unknown`.
 */
const GLOBAL_NAMED_TYPES = new Set([
  'Date',
  'File',
  'Blob',
  'FormData',
  'URL',
  'RegExp',
  'Map',
  'Set',
  'ArrayBuffer',
  'Uint8Array',
]);

/** Deep enough for any realistic payload; a cycle (`z.lazy`) stops long before. */
const MAX_DEPTH = 12;

interface RenderState {
  at: Node;
  /** Object types on the current path, to cut recursive schemas off at `unknown`. */
  stack: Set<ts.Type>;
  depth: number;
}

function objectKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function isOptionalSymbol(sym: TsSymbol): boolean {
  return (sym.getFlags() & ts.SymbolFlags.Optional) !== 0;
}

/** A symbol-keyed member (a zod brand, `[Symbol.iterator]`) — not a JSON field. */
function isSymbolKeyed(sym: TsSymbol): boolean {
  return sym.getName().startsWith('__@');
}

/**
 * A type's properties in SOURCE order. The checker's own order follows the ids of
 * the key literal types, which depend on everything else the program happened to
 * create first — zod 3's optional/required split re-maps keys that way — so the
 * same schema could print its fields in a different order after an unrelated route
 * was added. A mapped property keeps the declaration of the schema field it came
 * from, which fixes the order; one without a declaration keeps its place after them.
 */
function orderedProperties(type: Type): TsSymbol[] {
  const position = (sym: TsSymbol): [string, number] | undefined => {
    const decl = sym.getDeclarations()[0];
    return decl ? [decl.getSourceFile().getFilePath(), decl.getStart()] : undefined;
  };
  return type
    .getProperties()
    .map((sym, index) => ({ sym, index, at: position(sym) }))
    .sort((a, b) => {
      if (a.at && b.at) {
        if (a.at[0] !== b.at[0]) return a.at[0] < b.at[0] ? -1 : 1;
        if (a.at[1] !== b.at[1]) return a.at[1] - b.at[1];
      } else if (a.at || b.at) {
        return a.at ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.sym);
}

function isFromDeclarationFile(sym: TsSymbol | undefined): boolean {
  const decl = sym?.getDeclarations()[0];
  return !!decl && decl.getSourceFile().isDeclarationFile();
}

/**
 * Render `type` as a type expression the generated client can use verbatim.
 * `paired` is the matching OUTPUT type when rendering an input type: where the
 * input is `unknown` (zod 4's coerce accepts anything) the output stands in, and
 * object/array members are paired down the tree so this holds per field.
 */
function render(type: Type, state: RenderState, paired?: Type): string {
  if (state.depth > MAX_DEPTH) return 'unknown';

  if (isAnyOrUnknown(type)) {
    return paired && !isAnyOrUnknown(paired) ? render(paired, state) : 'unknown';
  }
  if (type.isNever()) return 'never';
  if (type.isString() || type.isTemplateLiteral()) return 'string';
  if (type.isNumber()) return 'number';
  if (type.isBoolean()) return 'boolean';
  if (type.isBigInt()) return 'bigint';
  if (type.isNull()) return 'null';
  if (type.isUndefined() || type.isVoid()) return 'undefined';
  if (type.isBooleanLiteral()) return type.getText();
  if (type.isStringLiteral() || type.isNumberLiteral() || type.isEnumLiteral()) {
    const value = type.getLiteralValue();
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
  }
  if (type.isBigIntLiteral()) return type.getText();
  if (type.isTypeParameter()) return 'unknown';

  if (type.isUnion()) return renderUnion(type, state, paired);
  if (type.isIntersection()) return renderIntersection(type, state);

  const next: RenderState = { ...state, depth: state.depth + 1 };

  if (type.isArray() || type.isReadonlyArray()) {
    const element = type.getArrayElementType() ?? type.getTypeArguments()[0];
    const pairedElement = paired?.getArrayElementType() ?? paired?.getTypeArguments()[0];
    return element ? `Array<${render(element, next, pairedElement)}>` : 'Array<unknown>';
  }
  if (type.isTuple()) {
    const elements = type.getTupleElements();
    const pairedElements = paired?.isTuple() ? paired.getTupleElements() : [];
    return `[${elements.map((e, i) => render(e, next, pairedElements[i])).join(', ')}]`;
  }

  if (type.isObject()) return renderObject(type, next, paired);

  // Anything left (an unresolved `unique symbol`, `object`, …) has no useful shape.
  return 'unknown';
}

function renderUnion(type: Type, state: RenderState, paired: Type | undefined): string {
  const members = type.getUnionTypes();
  const hasTrue = members.some((m) => m.isBooleanLiteral() && m.getText() === 'true');
  const hasFalse = members.some((m) => m.isBooleanLiteral() && m.getText() === 'false');
  // An input arm the checker could not narrow pairs with the output as a whole.
  const pairedNonNull = paired?.getNonNullableType();

  const arms: string[] = [];
  let sawBoolean = false;
  let hasNull = false;
  let hasUndefined = false;
  for (const member of members) {
    if (member.isNull()) {
      hasNull = true;
      continue;
    }
    if (member.isUndefined()) {
      hasUndefined = true;
      continue;
    }
    if (member.isBooleanLiteral() && hasTrue && hasFalse) {
      if (!sawBoolean) arms.push('boolean');
      sawBoolean = true;
      continue;
    }
    arms.push(render(member, state, members.length === 1 ? paired : pairedNonNull));
  }
  // `null`/`undefined` last, the way a person writes (and TypeScript prints) a union.
  if (hasNull) arms.push('null');
  if (hasUndefined) arms.push('undefined');
  const unique = [...new Set(arms)];
  if (unique.includes('unknown')) return 'unknown';
  return unique.join(' | ');
}

function renderIntersection(type: Type, state: RenderState): string {
  // A branded primitive (`string & { [BRAND]: 'UserId' }`) is the primitive on the wire.
  const members = type.getIntersectionTypes();
  const primitive = members.find((m) => !m.isObject());
  if (primitive) return render(primitive, state);
  // An intersection of objects (`A & B`, `.and()`, `.merge()` in some versions): the
  // checker resolves its members as one property set.
  return renderObject(type, { ...state, depth: state.depth + 1 }, undefined);
}

function renderObject(type: Type, state: RenderState, paired: Type | undefined): string {
  const symbol = type.getSymbol() ?? type.getAliasSymbol();
  const name = symbol?.getName();

  if (name && GLOBAL_NAMED_TYPES.has(name) && isFromDeclarationFile(symbol)) {
    const args = type.getTypeArguments();
    return args.length ? `${name}<${args.map((a) => render(a, state)).join(', ')}>` : name;
  }
  // A function type or a library class instance: no JSON shape to describe.
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
    return 'unknown';
  }
  if (type.isClassOrInterface() && isFromDeclarationFile(symbol)) return 'unknown';

  if (state.stack.has(type.compilerType)) return 'unknown';
  const stack = new Set(state.stack).add(type.compilerType);
  const inner: RenderState = { ...state, stack };

  const fields: string[] = [];
  for (const prop of orderedProperties(type)) {
    if (isSymbolKeyed(prop)) continue;
    const propName = prop.getName();
    const propT = prop.getTypeAtLocation(state.at);
    // Methods on a user-declared interface (`z.custom<Iface>()`) are not payload.
    if (propT.getCallSignatures().length > 0 && !propT.isUnion()) continue;
    const pairedProp = paired?.getProperty(propName)?.getTypeAtLocation(state.at);
    const optional = isOptionalSymbol(prop) ? '?' : '';
    fields.push(`${objectKey(propName)}${optional}: ${render(propT, inner, pairedProp)}`);
  }

  const stringIndex = type.getStringIndexType();
  if (stringIndex) {
    const pairedIndex = paired?.getStringIndexType();
    const value = render(stringIndex, inner, pairedIndex);
    if (fields.length === 0) return `Record<string, ${value}>`;
    fields.push(`[key: string]: ${value}`);
  }

  return fields.length ? `{ ${fields.join('; ')} }` : '{}';
}

function stateAt(at: Node): RenderState {
  return { at, stack: new Set(), depth: 0 };
}

// ---------------------------------------------------------------------------
// Public helpers — each takes the types an `inferSchema` call returned
// ---------------------------------------------------------------------------

/** The type a client SENDS for the schema: its input, output standing in where the input is `unknown`. */
export function requestTypeOf(types: SchemaTypes): string {
  return render(types.input, stateAt(types.at), types.output);
}

/** The type the server RETURNS for the schema: its output. */
export function responseTypeOf(types: SchemaTypes): string {
  return render(types.output, stateAt(types.at));
}

/** A field of a request schema's object input: its rendered type and whether it may be omitted. */
export interface SchemaField {
  name: string;
  type: string;
  optional: boolean;
}

/**
 * The request type split per top-level field — for a schema that types a whole
 * `@Param()` object. Null when the schema's input is not an object.
 */
export function requestFieldsOf(types: SchemaTypes): SchemaField[] | null {
  const { input, output, at } = types;
  const objectInput = input.getNonNullableType();
  if (!objectInput.isObject() || objectInput.isArray() || objectInput.isTuple()) return null;
  const state = stateAt(at);
  return orderedProperties(objectInput)
    .filter((prop) => !isSymbolKeyed(prop))
    .map((prop) => ({
      name: prop.getName(),
      type: render(
        prop.getTypeAtLocation(at),
        state,
        output.getProperty(prop.getName())?.getTypeAtLocation(at),
      ),
      optional: isOptionalSymbol(prop),
    }));
}

/** Whether the schema accepts `undefined` — i.e. the value may be left out entirely. */
export function acceptsUndefined(types: SchemaTypes): boolean {
  const { input, output } = types;
  // An `unknown` input (zod 4 coerce) says nothing; whether the value may be left
  // out is then what the schema produces for it.
  const accepted = isAnyOrUnknown(input) ? output : input;
  if (isAnyOrUnknown(accepted) || accepted.isUndefined()) return true;
  return accepted.isUnion() && accepted.getUnionTypes().some((t) => t.isUndefined());
}
