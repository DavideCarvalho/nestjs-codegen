import {
  type ClassDeclaration,
  type InterfaceDeclaration,
  type MethodDeclaration,
  Node,
  type Project,
  type SourceFile,
  SyntaxKind,
  type TypeNode,
} from 'ts-morph';
import { extractSchemaFromDto } from './dto-to-ir.js';
import { extractApplyFilterInfo } from './filter-for.js';
import {
  type TypeDeclResult,
  dbg,
  findType,
  resolveImportedType,
  resolveTypeRef,
} from './type-ref-resolution.js';
import type { FilterFieldType, TypeRef } from './types.js';

// ---------------------------------------------------------------------------
// DTO-based contract extraction (standard NestJS patterns — no defineContract)
// ---------------------------------------------------------------------------

/**
 * Wrapper type names whose wire shape reduces to their first type argument.
 *   - `unwrap`  → emit the type-arg as-is (e.g. Promise<T> → T)
 *   - `arrayOf` → wrap the type-arg in `Array<>` (e.g. Collection<T> → Array<T>)
 */
const WRAPPER_TYPES: Record<string, 'unwrap' | 'arrayOf'> = {
  // MikroORM Ref/Reference/LoadedReference/IdentifiedReference are server-side
  // wrappers around related entities; the wire shape is just the referenced
  // entity. Unwrap to the type argument.
  Ref: 'unwrap',
  Reference: 'unwrap',
  LoadedReference: 'unwrap',
  IdentifiedReference: 'unwrap',
  // MikroORM Opt<T> is a marker, Loaded<T, ...> is a wrapper; both reduce to T.
  Opt: 'unwrap',
  Loaded: 'unwrap',
  // Promise<T> — unwrap
  Promise: 'unwrap',
  // MikroORM Collection<T> serializes as an array of T on the wire.
  Collection: 'arrayOf',
  // Array<T> generic form
  Array: 'arrayOf',
};

/** Well-known utility types — preserve full text with type args. */
const PASSTHROUGH_UTILITY = new Set([
  'Record',
  'Omit',
  'Pick',
  'Partial',
  'Required',
  'Readonly',
  'Map',
  'Set',
]);

/**
 * Resolve a TypeNode to a TypeScript type-source string.
 * Follows imports across files via the ts-morph Project.
 * `depth` limits recursive expansion (guards against circular references).
 */
function resolveTypeNodeToString(
  typeNode: TypeNode,
  sourceFile: SourceFile,
  project: Project,
  depth: number,
): string {
  if (depth <= 0) return 'unknown';

  // Array<T> or T[] — unwrap and wrap
  if (Node.isArrayTypeNode(typeNode)) {
    const elementType = typeNode.getElementTypeNode();
    return `Array<${resolveTypeNodeToString(elementType, sourceFile, project, depth)}>`;
  }

  // Union: A | B | C — resolve each member so named refs get inlined
  if (Node.isUnionTypeNode(typeNode)) {
    return typeNode
      .getTypeNodes()
      .map((t) => resolveTypeNodeToString(t, sourceFile, project, depth))
      .join(' | ');
  }

  // Intersection: A & B — same treatment
  if (Node.isIntersectionTypeNode(typeNode)) {
    return typeNode
      .getTypeNodes()
      .map((t) => resolveTypeNodeToString(t, sourceFile, project, depth))
      .join(' & ');
  }

  // Parenthesized: ( ... ) — unwrap
  if (Node.isParenthesizedTypeNode(typeNode)) {
    return `(${resolveTypeNodeToString(typeNode.getTypeNode(), sourceFile, project, depth)})`;
  }

  // TypeReference: Foo, Foo[], Array<Foo>, Promise<Foo>, etc.
  if (Node.isTypeReference(typeNode)) {
    const typeName = typeNode.getTypeName();
    const name = Node.isIdentifier(typeName) ? typeName.getText() : typeNode.getText();

    // Well-known pass-through primitives and types
    if (name === 'string' || name === 'number' || name === 'boolean') return name;
    if (name === 'Date') return 'string';
    if (name === 'unknown' || name === 'any' || name === 'void') return 'unknown';
    // Server-only types that don't make sense on the client
    if (name === 'StreamableFile' || name === 'Observable' || name === 'ReadableStream')
      return 'unknown';

    // Known wrapper types — unwrap (or array-wrap) their first type argument.
    const wrapperMode = WRAPPER_TYPES[name];
    if (wrapperMode) {
      return unwrapFirstTypeArg(typeNode, sourceFile, project, depth, wrapperMode);
    }

    // Well-known utility types — preserve full text with type args
    if (PASSTHROUGH_UTILITY.has(name)) {
      return typeNode.getText();
    }

    // Try same file first, then follow imports (class, interface, type alias, enum)
    const resolved = findType(name, sourceFile, project);
    if (resolved) {
      return expandTypeDecl(resolved, project, depth - 1);
    }

    // Unresolvable type — use unknown instead of bare name to avoid TS errors in generated code
    dbg('unresolvable type:', name, 'in', sourceFile.getFilePath());
    return 'unknown';
  }

  // Primitive keyword types
  const kind = typeNode.getKind();
  if (kind === SyntaxKind.StringKeyword) return 'string';
  if (kind === SyntaxKind.NumberKeyword) return 'number';
  if (kind === SyntaxKind.BooleanKeyword) return 'boolean';
  if (kind === SyntaxKind.UnknownKeyword) return 'unknown';
  if (kind === SyntaxKind.AnyKeyword) return 'unknown';

  // Fallback: raw text
  return typeNode.getText();
}

/**
 * Unwrap the first type argument of a wrapper TypeReference. In `unwrap` mode
 * the type-arg is emitted as-is; in `arrayOf` mode it is wrapped in `Array<>`.
 * Falls back to `'unknown'` / `'Array<unknown>'` when no type-arg is present.
 */
function unwrapFirstTypeArg(
  typeNode: import('ts-morph').TypeReferenceNode,
  sourceFile: SourceFile,
  project: Project,
  depth: number,
  mode: 'unwrap' | 'arrayOf',
): string {
  const typeArgs = typeNode.getTypeArguments();
  const firstTypeArg = typeArgs[0];
  if (typeArgs.length > 0 && firstTypeArg !== undefined) {
    const inner = resolveTypeNodeToString(firstTypeArg, sourceFile, project, depth);
    return mode === 'arrayOf' ? `Array<${inner}>` : inner;
  }
  return mode === 'arrayOf' ? 'Array<unknown>' : 'unknown';
}

/**
 * Expand a TypeDeclResult into an inline TS type string.
 */
function expandTypeDecl(result: TypeDeclResult, project: Project, depth: number): string {
  if (depth < 0) return 'unknown';
  switch (result.kind) {
    case 'class':
      return resolvePropertied(result.decl, result.file, project, depth);
    case 'interface':
      return resolvePropertied(result.decl, result.file, project, depth);
    case 'typeAlias':
      // Recursively resolve the alias body so that any named types it
      // references (e.g. `A | B | C`) are expanded inline rather than left
      // as bare identifiers, which would be undefined in the emitted code.
      if (result.typeNode) {
        return resolveTypeNodeToString(result.typeNode, result.file, project, depth);
      }
      return result.text;
    case 'enum':
      return result.members.join(' | ');
  }
}

/**
 * Turn a class or interface declaration's properties into a TS object type string like
 * `{ id: string; title: string; page?: number }`.
 */
function resolvePropertied(
  decl: ClassDeclaration | InterfaceDeclaration,
  sourceFile: SourceFile,
  project: Project,
  depth: number,
): string {
  if (depth < 0) return 'unknown';

  const lines: string[] = [];
  for (const prop of decl.getProperties()) {
    const propName = prop.getName();
    const isOptional = prop.hasQuestionToken();
    const propTypeNode = prop.getTypeNode();
    let propType = 'unknown';
    if (propTypeNode) {
      propType = resolveTypeNodeToString(propTypeNode, sourceFile, project, depth);
    }
    lines.push(`${propName}${isOptional ? '?' : ''}: ${propType}`);
  }
  return `{ ${lines.join('; ')} }`;
}

/**
 * Extract the body type from a `@Body()` (no-arg) decorated parameter.
 * Returns a TS type string or null.
 */
function extractBodyType(
  method: MethodDeclaration,
  sourceFile: SourceFile,
  project: Project,
): string | null {
  for (const param of method.getParameters()) {
    const bodyDecorator = param.getDecorators().find((d) => d.getName() === 'Body');
    if (!bodyDecorator) continue;
    const bodyArgs = bodyDecorator.getArguments();
    if (bodyArgs.length > 0) continue;
    const typeNode = param.getTypeNode();
    if (typeNode) {
      return resolveTypeNodeToString(typeNode, sourceFile, project, 3);
    }
  }
  return null;
}

/**
 * Extract the query type from a `@Query()` (no-arg) decorated parameter.
 * Returns a TS type string or null.
 */
function extractQueryType(
  method: MethodDeclaration,
  sourceFile: SourceFile,
  project: Project,
): string | null {
  for (const param of method.getParameters()) {
    const queryDecorator = param.getDecorators().find((d) => d.getName() === 'Query');
    if (!queryDecorator) continue;
    const queryArgs = queryDecorator.getArguments();
    if (queryArgs.length > 0) continue;
    const typeNode = param.getTypeNode();
    if (typeNode) {
      return resolveTypeNodeToString(typeNode, sourceFile, project, 3);
    }
  }
  return null;
}

/**
 * Collect `@Param('name')` decorated parameters into a `{ name: type; ... }` string.
 * Returns a TS type string or null when no @Param decorators are present.
 */
function extractParamsType(
  method: MethodDeclaration,
  sourceFile: SourceFile,
  project: Project,
): string | null {
  const entries: string[] = [];
  for (const param of method.getParameters()) {
    const paramDecorator = param.getDecorators().find((d) => d.getName() === 'Param');
    if (!paramDecorator) continue;
    const paramArgs = paramDecorator.getArguments();
    if (paramArgs.length === 0) continue;
    const nameArg = paramArgs[0];
    if (!Node.isStringLiteral(nameArg)) continue;
    const paramName = nameArg.getLiteralValue();
    const typeNode = param.getTypeNode();
    const paramType = typeNode
      ? resolveTypeNodeToString(typeNode, sourceFile, project, 3)
      : 'string';
    entries.push(`${paramName}: ${paramType}`);
  }
  return entries.length > 0 ? `{ ${entries.join('; ')} }` : null;
}

/**
 * Extract the response type from `@ApiResponse({ type: X })` or `@ApiResponse({ type: [X] })`.
 * Falls back to the method return type annotation (unwrapping `Promise<>`).
 * Returns a TS type string (never null — falls back to 'unknown').
 */
function extractResponseType(
  method: MethodDeclaration,
  sourceFile: SourceFile,
  project: Project,
): string {
  // 1. Try @ApiResponse
  const apiResponseDecorator = method.getDecorator('ApiResponse');
  if (apiResponseDecorator) {
    const args = apiResponseDecorator.getArguments();
    const optsArg = args[0];
    if (optsArg && Node.isObjectLiteralExpression(optsArg)) {
      for (const prop of optsArg.getProperties()) {
        if (!Node.isPropertyAssignment(prop)) continue;
        if (prop.getName() !== 'type') continue;
        const val = prop.getInitializer();
        if (!val) continue;

        // type: [PostDto] — array syntax
        if (Node.isArrayLiteralExpression(val)) {
          const elements = val.getElements();
          const firstEl = elements[0];
          if (elements.length > 0 && firstEl !== undefined) {
            const innerType = resolveIdentifierToClassType(firstEl, sourceFile, project, 3);
            return `Array<${innerType}>`;
          }
          return 'Array<unknown>';
        }

        // type: PostDto — single class reference
        return resolveIdentifierToClassType(val, sourceFile, project, 3);
      }
    }
  }

  // 2. Fall back to return type annotation
  const returnTypeNode = method.getReturnTypeNode();
  if (returnTypeNode) {
    return resolveTypeNodeToString(returnTypeNode, sourceFile, project, 3);
  }

  return 'unknown';
}

/**
 * Resolve an expression (expected to be a class identifier) to its expanded type string.
 * E.g. the `PostDto` identifier in `@ApiResponse({ type: PostDto })`.
 */
function resolveIdentifierToClassType(
  node: Node,
  sourceFile: SourceFile,
  project: Project,
  depth: number,
): string {
  if (!Node.isIdentifier(node)) return 'unknown';
  const name = node.getText();
  const resolved = findType(name, sourceFile, project);
  if (resolved) {
    return expandTypeDecl(resolved, project, depth - 1);
  }
  return name;
}

/**
 * Resolve a `@Body()` / `@Query()` param or return-type `TypeNode` to a named
 * exported class/interface ref (unwrapping `Promise<T>` / `Array<T>` / `T[]`).
 * Thin wrapper over the shared {@link resolveTypeRef}.
 */
function resolveBodyQueryResponseRef(
  typeNode: TypeNode,
  sourceFile: SourceFile,
  project: Project,
): TypeRef | null {
  return resolveTypeRef(typeNode, sourceFile, project, {
    kinds: ['class', 'interface'],
    unwrapContainers: true,
  });
}

/**
 * Determine whether a method has any DTO-based contract info worth emitting
 * (body, query, params, or non-unknown response).
 * Returns a ContractSource-shaped object or null.
 */
export function extractDtoContract(
  method: MethodDeclaration,
  sourceFile: SourceFile,
  project: Project,
): {
  query: string | null;
  body: string | null;
  response: string;
  params: string | null;
  queryRef?: TypeRef | null;
  bodyRef?: TypeRef | null;
  responseRef?: TypeRef | null;
  filterFields?: string[] | null;
  filterFieldTypes?: FilterFieldType[] | null;
  filterSource?: 'body' | 'query' | null;
  formWarnings?: string[];
  bodySchema?: import('../ir/schema-node.js').SchemaModule | null;
  querySchema?: import('../ir/schema-node.js').SchemaModule | null;
} | null {
  let body = extractBodyType(method, sourceFile, project);
  const filterInfo = extractApplyFilterInfo(method, sourceFile, project);
  const query = extractQueryType(method, sourceFile, project);

  // Place filter type on the correct field based on @ApplyFilter source. The
  // body-source case still pre-renders a fixed `FilterQueryResult` here; the
  // query-source TypedFilterQuery TYPE is rendered in emit-api.ts (from
  // filterFields + filterFieldTypes) so it is byte-identical to the
  // `_filterQueryTyped<...>` factory args.
  if (filterInfo && filterInfo.source === 'body') {
    const bodyType = "import('@dudousxd/nestjs-filter-client').FilterQueryResult";
    body = body ?? bodyType;
  }

  const paramsType = extractParamsType(method, sourceFile, project);
  const response = extractResponseType(method, sourceFile, project);

  // Only emit a contract if there is at least something useful. A query-source
  // `@ApplyFilter` route carries no pre-rendered `query` string anymore (the
  // TypedFilterQuery type is rendered in emit-api), so it must be kept alive via
  // `filterInfo` even when every other field is empty.
  if (
    body === null &&
    query === null &&
    paramsType === null &&
    response === 'unknown' &&
    filterInfo === null
  ) {
    return null;
  }

  // Capture type references for import generation
  let bodyRef: TypeRef | null = null;
  let queryRef: TypeRef | null = null;
  let responseRef: TypeRef | null = null;

  for (const param of method.getParameters()) {
    if (param.getDecorators().some((d) => d.getName() === 'Body') && param.getTypeNode()) {
      bodyRef = resolveBodyQueryResponseRef(param.getTypeNode()!, sourceFile, project);
    }
    if (param.getDecorators().some((d) => d.getName() === 'Query') && param.getTypeNode()) {
      queryRef = resolveBodyQueryResponseRef(param.getTypeNode()!, sourceFile, project);
    }
  }

  const returnTypeNode = method.getReturnTypeNode();
  if (returnTypeNode) {
    responseRef = resolveBodyQueryResponseRef(returnTypeNode, sourceFile, project);
  }
  // Also check @ApiResponse
  if (!responseRef) {
    const apiResp = method.getDecorator('ApiResponse');
    if (apiResp) {
      const args = apiResp.getArguments();
      const optsArg = args[0];
      if (optsArg && Node.isObjectLiteralExpression(optsArg)) {
        for (const prop of optsArg.getProperties()) {
          if (Node.isPropertyAssignment(prop) && prop.getName() === 'type') {
            const val = prop.getInitializer();
            if (val && Node.isIdentifier(val)) {
              const name = val.getText();
              const localDecl =
                sourceFile.getInterface(name) ||
                sourceFile.getClass(name) ||
                sourceFile.getTypeAlias(name);
              if (localDecl?.isExported()) {
                responseRef = { name, filePath: sourceFile.getFilePath() };
              } else {
                const resolved = resolveImportedType(name, sourceFile, project);
                if (
                  resolved &&
                  (resolved.kind === 'class' || resolved.kind === 'interface') &&
                  resolved.decl.isExported()
                ) {
                  responseRef = { name, filePath: resolved.file.getFilePath() };
                }
              }
            }
          }
        }
      }
    }
  }

  // ── Synthesize the neutral validation IR from class-validator DTOs (Path B) ─
  // Resolve the @Body()/@Query() param to a class declaration and translate its
  // decorators into the neutral IR, which emit-forms renders via any adapter
  // (zod included). A defineContract schema always wins, so this only runs on
  // the plain-verb path where no contract schema is present.
  let bodySchema: import('../ir/schema-node.js').SchemaModule | null = null;
  let querySchema: import('../ir/schema-node.js').SchemaModule | null = null;
  const formWarnings: string[] = [];

  const bodyClass = resolveParamClass(method, 'Body', sourceFile, project);
  if (bodyClass) {
    bodySchema = extractSchemaFromDto(bodyClass.decl, bodyClass.file, project);
    formWarnings.push(...bodySchema.warnings);
  }
  const queryClass = resolveParamClass(method, 'Query', sourceFile, project);
  if (queryClass) {
    querySchema = extractSchemaFromDto(queryClass.decl, queryClass.file, project);
    formWarnings.push(...querySchema.warnings);
  }

  return {
    query,
    body,
    response,
    params: paramsType,
    queryRef,
    bodyRef,
    responseRef,
    filterFields: filterInfo?.fieldNames ?? null,
    filterFieldTypes: filterInfo?.fieldTypes ?? null,
    filterSource: filterInfo?.source ?? null,
    formWarnings,
    bodySchema,
    querySchema,
  };
}

/**
 * Resolve a `@Body()` / `@Query()` parameter's TS type to a class declaration
 * (following imports). Returns null for interfaces / plain types / unresolved.
 */
function resolveParamClass(
  method: MethodDeclaration,
  decoratorName: 'Body' | 'Query',
  sourceFile: SourceFile,
  project: Project,
): { decl: ClassDeclaration; file: SourceFile } | null {
  for (const param of method.getParameters()) {
    if (!param.getDecorators().some((d) => d.getName() === decoratorName)) continue;
    const typeNode = param.getTypeNode();
    if (!typeNode) continue;
    // Strip array suffix — translate the element class.
    const text = typeNode.getText().replace(/\[\]$/, '');
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) continue;
    const resolved = findType(text, sourceFile, project);
    if (resolved && resolved.kind === 'class') {
      return { decl: resolved.decl, file: resolved.file };
    }
  }
  return null;
}
