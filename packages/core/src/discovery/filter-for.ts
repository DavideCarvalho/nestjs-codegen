import {
  type ClassDeclaration,
  type MethodDeclaration,
  Node,
  type Project,
  type PropertyDeclaration,
  type SourceFile,
} from 'ts-morph';
import {
  type ClassifyResult,
  classifyFieldType,
  classifyTypeNode,
  toFilterFieldType,
} from './filter-field-types.js';
import { resolveFactoryStaticClass } from './heritage.js';
import { findType, resolveTypeRef } from './type-ref-resolution.js';
import type { FilterFieldType, MixinBinding } from './types.js';

/**
 * Resolve the entity class a controller factory was called with.
 *
 * A factory-generated filter carries `@Filterable({ entity })` where `entity` is
 * the factory's own parameter — it names nothing resolvable in that file. The
 * concrete class only exists at the call site, which the route's mixin binding
 * recorded by name + file.
 */
function resolveMixinEntityClass(
  mixin: MixinBinding | undefined,
  project: Project,
): ClassDeclaration | undefined {
  const entityArg = mixin?.classArgs[0];
  if (!entityArg) return undefined;

  const file =
    project.getSourceFile(entityArg.filePath) ??
    project.addSourceFileAtPathIfExists(entityArg.filePath);
  return file?.getClass(entityArg.name);
}

/**
 * `@FilterFor` / `@ApplyFilter` discovery: resolve the virtual + entity-derived
 * filter fields (with their classified types) for a filter class referenced by
 * an `@ApplyFilter(FilterClass)` parameter.
 */

/**
 * Map a single `@FilterFor` `type` hint token (read statically from the AST) to a
 * `ClassifyResult`. Supports the four primitive tokens plus a string-literal
 * array (enum) → literal string union. Returns null for anything unrecognised so
 * the caller falls back to the current permissive (`unknown`) behavior.
 */
export function classifyFilterForHint(typeInit: Node): ClassifyResult | null {
  // Primitive token: 'string' | 'number' | 'boolean' | 'Date'
  if (Node.isStringLiteral(typeInit)) {
    switch (typeInit.getLiteralValue()) {
      case 'string':
        return { kind: 'string' };
      case 'number':
        return { kind: 'number' };
      case 'boolean':
        return { kind: 'boolean' };
      case 'Date':
        return { kind: 'date' };
      default:
        return null;
    }
  }

  // Enum: a readonly array of string literals → literal string union.
  if (Node.isArrayLiteralExpression(typeInit)) {
    const values: string[] = [];
    for (const el of typeInit.getElements()) {
      if (!Node.isStringLiteral(el)) return null; // non-literal → bail to permissive
      values.push(el.getLiteralValue());
    }
    if (values.length === 0) return null;
    return { kind: 'string', enumValues: values };
  }

  return null;
}

/**
 * Classify the type of the FIRST parameter of a `@FilterFor` method (the new
 * primary inference mechanism). Precedence inside this function:
 *   - primitive `number`/`string`/`boolean`/`Date` → emit directly.
 *   - literal unions (`'a' | 'b'`, `1 | 2`) → emit the union text.
 *   - named enum / type alias / interface → emit a `typeRef` (named import,
 *     option B) when an import path is resolvable; otherwise fall back to
 *     literal-union expansion for enums/unions, else skip.
 *   - any/unknown/no-param/unresolvable → null (caller falls back).
 */
export function classifyFilterForParam(
  method: MethodDeclaration,
  sourceFile: SourceFile,
  project: Project,
): ClassifyResult | null {
  const param = method.getParameters()[0];
  if (!param) return null;
  const typeNode = param.getTypeNode();
  if (!typeNode) return null;

  // Classify ONCE. `resolveRef` attaches an importable named ref (option B) when
  // the symbol resolves to an exported enum / type alias / interface / class with
  // a safe import path; the emitter prefers that `typeRef` over the `kind`. The
  // best-effort `kind` is still recorded so non-emit consumers (tests) see a
  // sensible classification.
  const wellKnown = ['string', 'number', 'boolean', 'Date', 'any', 'unknown'];
  const result = classifyTypeNode(typeNode, sourceFile, project, {
    resolveRef: (refName) => {
      if (wellKnown.includes(refName)) return null;
      // Only attempt a named import for symbols we can resolve to a declaration.
      if (!findType(refName, sourceFile, project)) return null;
      return resolveTypeRef(refName, sourceFile, project, {
        kinds: ['class', 'interface', 'typeAlias', 'enum'],
        allowBareSpecifier: true,
      });
    },
  });

  // A resolved `typeRef` is always usable (even with kind 'unknown' — the emitter
  // references the ref by name). Otherwise skip permissive `unknown` results.
  if (result.typeRef) return result;
  return result.kind === 'unknown' ? null : result;
}

/**
 * Discover virtual filter fields declared via `@FilterFor('key', { type })`
 * method decorators on the filter class. Field-type resolution precedence (high
 * wins): (1) explicit `{ type }` hint, (2) the method's first-parameter type
 * (named enums/aliases → real `import type` refs), (3+) fall back to existing
 * class-property / entity-column / `unknown` behavior (handled by the caller).
 *
 * Returns a map of inputKey → classified type for every `@FilterFor` that
 * carries a usable hint OR a usable first-parameter type. Keys with neither are
 * intentionally omitted here (they remain permissive / fall back).
 */
export function extractFilterForHints(
  classDecl: ClassDeclaration,
  project: Project,
): Map<string, ClassifyResult> {
  const hints = new Map<string, ClassifyResult>();
  const sourceFile = classDecl.getSourceFile();
  for (const method of classDecl.getMethods()) {
    const filterForDec = method.getDecorators().find((d) => d.getName() === 'FilterFor');
    if (!filterForDec) continue;

    const args = filterForDec.getArguments();
    // inputKey: first string-literal arg, else the method name.
    const keyArg = args[0];
    const inputKey =
      keyArg && Node.isStringLiteral(keyArg) ? keyArg.getLiteralValue() : method.getName();

    // (1) Explicit `{ type }` hint — highest precedence, unchanged behavior.
    const optsArg = args[1];
    if (optsArg && Node.isObjectLiteralExpression(optsArg)) {
      const typeProp = optsArg.getProperty('type');
      if (typeProp && Node.isPropertyAssignment(typeProp)) {
        const typeInit = typeProp.getInitializer();
        if (typeInit) {
          const classified = classifyFilterForHint(typeInit);
          if (classified) {
            hints.set(inputKey, classified);
            continue;
          }
        }
      }
    }

    // (2) Method first-parameter type — the new primary inference mechanism.
    const fromParam = classifyFilterForParam(method, sourceFile, project);
    if (fromParam) hints.set(inputKey, fromParam);
  }
  return hints;
}

/**
 * Extract the filter field data from an `@ApplyFilter(FilterClass)` decorated
 * parameter. Resolves the filter class and reads its properties (excluding
 * inherited base class members). Returns the field names + classified types +
 * filter source, or null when no resolvable filter is present.
 */
export function extractApplyFilterInfo(
  method: MethodDeclaration,
  sourceFile: SourceFile,
  project: Project,
  mixin?: MixinBinding | undefined,
): {
  fieldNames: string[];
  fieldTypes: FilterFieldType[];
  source: 'body' | 'query';
} | null {
  // For a mixin route the method is declared in the factory's file, not in the
  // controller's — so the `@ApplyFilter(X)` target must be resolved from there.
  // For an ordinary route these are the same file.
  const declFile = method.getSourceFile();
  // The generated filter's `@Filterable({ entity })` names the factory's own
  // parameter, which resolves to nothing. The real entity is the call-site
  // argument, carried on the mixin binding.
  const mixinEntity = resolveMixinEntityClass(mixin, project);
  for (const param of method.getParameters()) {
    const filterDecorator = param.getDecorators().find((d) => d.getName() === 'ApplyFilter');
    if (!filterDecorator) continue;
    const args = filterDecorator.getArguments();
    if (args.length === 0) continue;
    const filterClassArg = args[0];
    if (!filterClassArg) continue;
    // `@ApplyFilter(SomeTable.filter)` — the override escape hatch. Resolved
    // through the factory rather than by name, since the filter class it names
    // has no module-level declaration to look up.
    const factoryStaticClass = resolveFactoryStaticClass(filterClassArg);
    if (!factoryStaticClass && !Node.isIdentifier(filterClassArg)) continue;

    // Read { source: "body" | "query" } from second argument
    let source: 'body' | 'query' = 'query';
    const optionsArg = args[1];
    if (optionsArg && Node.isObjectLiteralExpression(optionsArg)) {
      const sourceProp = optionsArg.getProperty('source');
      if (sourceProp && Node.isPropertyAssignment(sourceProp)) {
        const init = sourceProp.getInitializer();
        if (init && Node.isStringLiteral(init) && init.getLiteralValue() === 'body') {
          source = 'body';
        }
      }
    }

    const filterClassName = filterClassArg.getText();
    const resolved = factoryStaticClass ? undefined : findType(filterClassName, declFile, project);
    // `findType` looks up module-level declarations and imports. A factory's
    // generated filter is declared INSIDE the factory function, so it is
    // invisible there — but the decorator's identifier still points straight at
    // it lexically.
    const classDecl =
      factoryStaticClass ??
      (resolved?.kind === 'class'
        ? (resolved.decl as ClassDeclaration)
        : resolveLocalClassDeclaration(filterClassArg));
    if (classDecl) {
      let fieldTypes = extractClassPropertyTypes(classDecl, project);

      // autoFields: if the filter class has no properties, resolve fields
      // from the entity referenced in @Filterable({ entity: X })
      if (fieldTypes.length === 0) {
        fieldTypes = extractFilterableEntityFields(classDecl, project, mixinEntity);
      }

      // Merge in explicit @FilterFor('key', { type }) hints. An explicit hint
      // WINS over entity-column / class-property inference for the same key;
      // genuinely-virtual keys (no property, no column) are appended so they
      // appear in the Fields union and the type map M.
      const filterForHints = extractFilterForHints(classDecl, project);
      if (filterForHints.size > 0) {
        const byName = new Map(fieldTypes.map((f) => [f.name, f] as const));
        for (const [key, classified] of filterForHints) {
          byName.set(key, toFilterFieldType(key, classified));
        }
        fieldTypes = [...byName.values()];
      }

      if (fieldTypes.length === 0) return null;
      const fieldNames = fieldTypes.map((f) => f.name);
      return {
        fieldNames,
        fieldTypes,
        source,
      };
    }
  }
  return null;
}

const RELATION_DECORATORS = new Set(['OneToMany', 'ManyToOne', 'ManyToMany', 'OneToOne']);

/**
 * Recursively collect entity fields including dot-notation relation fields.
 * e.g. for PipelineRun with tasks: OneToMany<Task>, produces:
 *   ["id", "name", "status", ..., "tasks.id", "tasks.name", ...]
 */
function collectEntityFields(
  entityDecl: ClassDeclaration,
  sourceFile: SourceFile,
  project: Project,
  prefix: string,
  visited: Set<string>,
): FilterFieldType[] {
  const entityName = entityDecl.getName() ?? '';
  if (visited.has(entityName)) return [];
  visited.add(entityName);

  const fields: FilterFieldType[] = [];
  for (const prop of entityDecl.getProperties()) {
    const name = prop.getName();
    if (name.startsWith('$') || name.startsWith('_') || name.startsWith('[')) continue;
    if (prop.isStatic()) continue;

    const fullName = prefix ? `${prefix}.${name}` : name;
    const isRelation = prop.getDecorators().some((d) => RELATION_DECORATORS.has(d.getName()));

    if (isRelation) {
      const relEntity = resolveRelationEntity(prop, sourceFile, project);
      if (relEntity) {
        // Classify each relation leaf against the relation's own source file.
        fields.push(
          ...collectEntityFields(relEntity, relEntity.getSourceFile(), project, fullName, visited),
        );
      }
    } else {
      fields.push(toFilterFieldType(fullName, classifyFieldType(prop, sourceFile, project)));
    }
  }
  return fields;
}

/**
 * Given a relation property (e.g. `tasks = new Collection<Task>(this)`),
 * resolve the target entity class declaration.
 */
function resolveRelationEntity(
  prop: PropertyDeclaration,
  sourceFile: SourceFile,
  project: Project,
): ClassDeclaration | null {
  // Try from decorator argument: @OneToMany({ entity: () => Task, ... })
  for (const dec of prop.getDecorators()) {
    if (!RELATION_DECORATORS.has(dec.getName())) continue;
    const args = dec.getArguments();
    if (args.length === 0) continue;
    const arg = args[0];
    if (Node.isObjectLiteralExpression(arg)) {
      const entityProp = arg.getProperty('entity');
      if (entityProp && Node.isPropertyAssignment(entityProp)) {
        const init = entityProp.getInitializer();
        // () => Task
        if (init && Node.isArrowFunction(init)) {
          const body = init.getBody();
          if (Node.isIdentifier(body)) {
            const resolved = findType(body.getText(), prop.getSourceFile(), project);
            if (resolved?.kind === 'class') return resolved.decl as ClassDeclaration;
          }
        }
      }
    }
    // @ManyToOne(() => Task)
    if (Node.isArrowFunction(arg)) {
      const body = arg.getBody();
      if (Node.isIdentifier(body)) {
        const resolved = findType(body.getText(), prop.getSourceFile(), project);
        if (resolved?.kind === 'class') return resolved.decl as ClassDeclaration;
      }
    }
  }
  return null;
}

/** Classify each property of a filter DTO class into a FilterFieldType. */
function extractClassPropertyTypes(
  classDecl: ClassDeclaration,
  project: Project,
): FilterFieldType[] {
  const sourceFile = classDecl.getSourceFile();
  const fields: FilterFieldType[] = [];
  for (const prop of classDecl.getProperties()) {
    const name = prop.getName();
    if (name.startsWith('$') || name.startsWith('_')) continue;
    fields.push(toFilterFieldType(name, classifyFieldType(prop, sourceFile, project)));
  }
  return fields;
}

/**
 * When a filter class uses `@Filterable({ entity: X, autoFields: true })`,
 * resolve entity X and extract its property names (fields decorated with
 * `@Property`, `@PrimaryKey`, `@Enum`, etc. — skipping relations).
 */
/**
 * Resolve an identifier to a class declared in an enclosing local scope (e.g. a
 * filter class generated inside a controller factory), which module-level
 * lookups can't see.
 */
function resolveLocalClassDeclaration(identifier: Node): ClassDeclaration | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;
  return identifier
    .getDefinitions()
    .map((d) => d.getDeclarationNode())
    .find((n): n is ClassDeclaration => n !== undefined && Node.isClassDeclaration(n));
}

/** Resolve `@Filterable({ entity: X })` where `X` is a real class identifier. */
function resolveDeclaredEntity(
  optionsArg: Node,
  filterClass: ClassDeclaration,
  project: Project,
): ClassDeclaration | undefined {
  if (!Node.isObjectLiteralExpression(optionsArg)) return undefined;
  const entityProp = optionsArg.getProperty('entity');
  if (!entityProp || !Node.isPropertyAssignment(entityProp)) return undefined;

  const entityInit = entityProp.getInitializer();
  if (!entityInit || !Node.isIdentifier(entityInit)) return undefined;

  const resolved = findType(entityInit.getText(), filterClass.getSourceFile(), project);
  if (!resolved || resolved.kind !== 'class') return undefined;
  return resolved.decl as ClassDeclaration;
}

function extractFilterableEntityFields(
  filterClass: ClassDeclaration,
  project: Project,
  entityOverride?: ClassDeclaration | undefined,
): FilterFieldType[] {
  const filterableDecorator = filterClass.getDecorators().find((d) => d.getName() === 'Filterable');
  if (!filterableDecorator) return [];
  const args = filterableDecorator.getArguments();
  if (args.length === 0) return [];

  const optionsArg = args[0];
  if (!Node.isObjectLiteralExpression(optionsArg)) return [];

  const entityDecl = entityOverride ?? resolveDeclaredEntity(optionsArg, filterClass, project);
  if (!entityDecl) return [];
  const fields = collectEntityFields(
    entityDecl,
    entityDecl.getSourceFile(),
    project,
    '',
    new Set(),
  );

  // Also include keys declared via @Relations({ rel: { keys: [...] } }).
  // These string keys carry no resolvable type → kind: 'unknown'.
  const relationsDecorator = filterClass.getDecorators().find((d) => d.getName() === 'Relations');
  if (relationsDecorator) {
    const relArgs = relationsDecorator.getArguments();
    if (relArgs.length > 0 && Node.isObjectLiteralExpression(relArgs[0])) {
      for (const relProp of relArgs[0].getProperties()) {
        if (!Node.isPropertyAssignment(relProp)) continue;
        const relInit = relProp.getInitializer();
        if (!relInit || !Node.isObjectLiteralExpression(relInit)) continue;
        const keysProp = relInit.getProperty('keys');
        if (!keysProp || !Node.isPropertyAssignment(keysProp)) continue;
        const keysInit = keysProp.getInitializer();
        if (!keysInit || !Node.isArrayLiteralExpression(keysInit)) continue;
        for (const el of keysInit.getElements()) {
          if (Node.isStringLiteral(el)) {
            // Route through the single constructor (keeps the typeRef invariant
            // enforced in one place); these relation keys carry no type → unknown.
            fields.push(toFilterFieldType(el.getLiteralValue(), { kind: 'unknown' }));
          }
        }
      }
    }
  }

  return fields;
}
