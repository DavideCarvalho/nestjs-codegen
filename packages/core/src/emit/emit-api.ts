import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type {
  ContractSource,
  ControllerRef,
  FieldTypeKind,
  FilterFieldType,
  RouteDescriptor,
} from '../discovery/types.js';
import type { RequestModel } from '../extension/types.js';

/**
 * Emits `api.ts` into `outDir` for all routes that carry a `.contract`.
 * - GET routes get `queryOptions`
 * - POST/PUT/PATCH/DELETE routes get `mutationOptions`
 */
export interface ApiEmitOptions {
  fetcherImportPath?: string;
  /** `'inertia'` (default) emits the Inertia `navigate()` helper; `'fetcher'` omits it (no @inertiajs import). */
  mutationClient?: 'fetcher' | 'inertia';
  /** Module to import `queryOptions`/`mutationOptions` from. Default `@tanstack/react-query`. */
  queryImport?: string;
  /** Emit TanStack handles (`.queryOptions()`/`.mutationOptions()`). Default false (plain fetch). */
  query?: boolean;
}

export async function emitApi(
  routes: RouteDescriptor[],
  outDir: string,
  opts: ApiEmitOptions = {},
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const content = buildApiFile(routes, outDir, opts);
  await writeFile(join(outDir, 'api.ts'), content, 'utf8');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Split a dot-notation name into its path segments. */
function splitName(name: string): string[] {
  return name.split('.');
}

/**
 * Check whether a segment is a valid JS identifier.
 * If not, we wrap it in quotes so it produces a valid object key.
 */
function toObjectKey(segment: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
    return segment;
  }
  return JSON.stringify(segment);
}

/**
 * Convert an arbitrary string segment to camelCase by splitting on non-alphanumeric chars.
 */
function toCamelCase(s: string): string {
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word, i) =>
      i === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('');
}

/**
 * Validate that a single name segment matches camelCase: starts with a lowercase letter,
 * followed only by alphanumeric chars. Throws a descriptive error on invalid segments.
 */
function validateNameSegment(seg: string, fullName: string): void {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(seg)) {
    const suggested = toCamelCase(seg);
    throw new Error(
      `Contract name "${fullName}" has invalid segment "${seg}". Use camelCase identifiers only (lowercase letter then alphanumeric). Suggested: "${suggested}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Nested tree helpers
// ---------------------------------------------------------------------------

type LeafEntry = {
  kind: 'leaf';
  method: string;
  name: string;
  path: string;
  params: Array<{ name: string; source: string }>;
  controllerRef?: ControllerRef | undefined;
  // Reference the canonical discovery type directly rather than re-declaring a
  // parallel hand-maintained shape. The leaf is always built from a real
  // `ContractSource` (`contractSource: r.contract.contractSource`), so the extra
  // form/zod fields it carries are simply unused here.
  contractSource: ContractSource;
};

type BranchEntry = {
  kind: 'branch';
  children: Map<string, TreeNode>;
};

type TreeNode = LeafEntry | BranchEntry;

/**
 * Insert a contracted route into the mutable tree.
 * Throws if a name conflict is detected.
 */
function insertIntoTree(
  tree: Map<string, TreeNode>,
  segments: string[],
  leaf: LeafEntry,
  fullName: string,
): void {
  const head = segments[0] as string;
  const rest = segments.slice(1);

  if (rest.length === 0) {
    // This is the final segment — insert as a leaf
    const existing = tree.get(head);
    if (existing !== undefined && existing.kind === 'branch') {
      throw new Error(
        `Contract name conflict: "${fullName}" cannot have both a direct entry and child entries`,
      );
    }
    tree.set(head, leaf);
  } else {
    // Need to recurse into a branch
    const existing = tree.get(head);
    if (existing !== undefined && existing.kind === 'leaf') {
      // The leaf's name is the prefix of fullName
      const prefixName = fullName
        .split('.')
        .slice(0, segments.length - rest.length)
        .join('.');
      throw new Error(
        `Contract name conflict: "${prefixName}" cannot have both a direct entry and child entries`,
      );
    }
    let branch: BranchEntry;
    if (existing === undefined) {
      branch = { kind: 'branch', children: new Map() };
      tree.set(head, branch);
    } else {
      branch = existing as BranchEntry;
    }
    insertIntoTree(branch.children, rest, leaf, fullName);
  }
}

// ---------------------------------------------------------------------------
// Params helpers
// ---------------------------------------------------------------------------

/**
 * Build a TypeScript type literal for path params.
 * Returns 'never' when the route has no path params.
 */
function buildParamsType(params: Array<{ name: string; source: string }>): string {
  const pathParams = params.filter((p) => p.source === 'path');
  if (pathParams.length === 0) return 'never';
  return `{ ${pathParams.map((p) => `${p.name}: string`).join('; ')} }`;
}

/**
 * Check whether a route has any path params.
 */
function hasPathParams(params: Array<{ name: string; source: string }>): boolean {
  return params.some((p) => p.source === 'path');
}

// ---------------------------------------------------------------------------
// Code generation helpers
// ---------------------------------------------------------------------------

/** Map a classified field kind (+ enum members) to a TS type literal. */
function kindToTs(kind: FieldTypeKind, enumValues?: string[], numericEnum?: boolean): string {
  if (enumValues && enumValues.length > 0) {
    return enumValues.map((v) => (numericEnum ? v : JSON.stringify(v))).join(' | ');
  }
  switch (kind) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'json':
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

/**
 * Emit the per-field type map literal: `{ "age": number; "status": "A" | "B" }`.
 * This is the SOLE emit-side reader of `FilterFieldType` — it owns the `typeRef`
 * precedence invariant (a named ref wins over `kind`/`enumValues`; see the
 * `FilterFieldType` doc). No other emit code branches on `typeRef` vs `kind`.
 */
function emitFieldTypesLiteral(fts: FilterFieldType[]): string {
  const entries = fts.map((f) => {
    // A named typeRef (enum / type alias / interface inferred from a @FilterFor
    // method parameter) wins — reference it by name; the import is emitted at
    // the top of the file by buildApiFile.
    let t = f.typeRef ? f.typeRef.name : kindToTs(f.kind, f.enumValues, f.numericEnum);
    if (f.nullable) t = `${t} | null`;
    return `${JSON.stringify(f.name)}: ${t}`;
  });
  return `{ ${entries.join('; ')} }`;
}

/** Build the type args for `_filterQueryTyped` — single union, or union + field-type map. */
function emitFilterQueryTypeArgs(c: LeafEntry): string {
  const fieldsUnion = (c.contractSource.filterFields ?? [])
    .map((f) => JSON.stringify(f))
    .join(' | ');
  const fts = c.contractSource.filterFieldTypes;
  return fts?.length ? `${fieldsUnion}, ${emitFieldTypesLiteral(fts)}` : fieldsUnion;
}

/**
 * Build the `TypedFilterQuery<...>` TYPE for a query-source `@ApplyFilter` route's
 * `query` position. Built from the SAME `emitFilterQueryTypeArgs` used by the
 * `_filterQueryTyped<...>` factory so the two are byte-identical.
 */
function emitFilterQueryType(c: LeafEntry): string {
  return `import('@dudousxd/nestjs-filter-client').TypedFilterQuery<${emitFilterQueryTypeArgs(c)}>`;
}

/**
 * Emit the nested ApiRouter type block.
 */
function buildResponseType(c: LeafEntry, outDir: string): string {
  if (c.controllerRef) {
    let relPath = relative(outDir, c.controllerRef.filePath).replace(/\.ts$/, '');
    if (!relPath.startsWith('.')) relPath = `./${relPath}`;
    return `Awaited<ReturnType<import('${relPath}').${c.controllerRef.className}['${c.controllerRef.methodName}']>>`;
  }
  const respRef = c.contractSource.responseRef;
  if (respRef) {
    return respRef.isArray ? `Array<${respRef.name}>` : respRef.name;
  }
  return c.contractSource.response;
}

function emitRouterTypeBlock(
  tree: Map<string, TreeNode>,
  indent: number,
  outDir: string,
): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  for (const [key, node] of tree) {
    const objKey = toObjectKey(key);
    if (node.kind === 'leaf') {
      const c = node;
      const method = c.method.toUpperCase();
      const queryRef = c.contractSource.queryRef;
      // A query-source `@ApplyFilter` route renders its `TypedFilterQuery<...>`
      // type here — from the same `filterFields`/`filterFieldTypes` data the
      // `_filterQueryTyped<...>` factory uses — so both are byte-identical.
      const isFilterQuery =
        c.contractSource.filterSource === 'query' && !!c.contractSource.filterFields?.length;
      const query = queryRef
        ? queryRef.isArray
          ? `Array<${queryRef.name}>`
          : queryRef.name
        : isFilterQuery
          ? emitFilterQueryType(c)
          : (c.contractSource.query ?? 'never');
      const bodyRef = c.contractSource.bodyRef;
      const body =
        method === 'GET'
          ? 'never'
          : bodyRef
            ? bodyRef.isArray
              ? `Array<${bodyRef.name}>`
              : bodyRef.name
            : (c.contractSource.body ?? 'never');
      const response = buildResponseType(c, outDir);
      const params = buildParamsType(c.params);
      const safeMethod = JSON.stringify(method);
      const safeUrl = JSON.stringify(c.path);
      // Filterable fields (from @dudousxd/nestjs-filter) as a string-literal
      // union, or `never` for routes without a filter. Purely type-level — no
      // runtime dependency on nestjs-filter is introduced by this member.
      const filterFields = c.contractSource.filterFields?.length
        ? c.contractSource.filterFields.map((f) => JSON.stringify(f)).join(' | ')
        : 'never';
      lines.push(
        `${pad}${objKey}: { method: ${safeMethod}; url: ${safeUrl}; params: ${params}; query: ${query}; body: ${body}; response: ${response}; filterFields: ${filterFields} };`,
      );
    } else {
      lines.push(`${pad}${objKey}: {`);
      lines.push(...emitRouterTypeBlock(node.children, indent + 2, outDir));
      lines.push(`${pad}};`);
    }
  }

  return lines;
}

/**
 * Build the neutral per-leaf {@link RequestModel} from a discovered leaf. This is the
 * input every transport/layer/member-contributor reads — the seam the extension system
 * plugs into. Pure string-building; no I/O.
 */
function buildRequestModel(c: LeafEntry): RequestModel {
  const isGet = c.method.toUpperCase() === 'GET';
  const m = c.method.toLowerCase() as RequestModel['method'];
  const flat = JSON.stringify(c.name);
  const path = JSON.stringify(c.path);
  const TA = buildRouterTypeAccess(c.name);
  const withParams = hasPathParams(c.params);
  const hasBody =
    !!c.contractSource.bodyRef ||
    (c.contractSource.body != null && c.contractSource.body !== 'never');

  const fields: string[] = [];
  if (withParams) fields.push(`params: ${TA}['params']`);
  if (isGet) fields.push(`query?: ${TA}['query']`);
  if (!isGet && hasBody) fields.push(`body?: ${TA}['body']`);
  const inputType = fields.length ? `{ ${fields.join('; ')} }` : 'Record<string, never>';

  const urlExpr = withParams
    ? `route(${flat} as never, input?.params as never) || ${path}`
    : `route(${flat} as never) || ${path}`;
  const optsExpr = isGet
    ? '{ query: input?.query as Record<string, unknown> | undefined }'
    : '{ body: input?.body }';

  return {
    routeName: c.name,
    method: m,
    isGet,
    hasParams: withParams,
    hasBody,
    inputType,
    urlExpr,
    optsExpr,
    responseType: `${TA}['response']`,
    bodyType: `${TA}['body']`,
    queryKeyExpr: `[${flat}, input] as const`,
  };
}

/**
 * The bundled default transport: a typed call on the injected `fetcher`. This is the
 * fallback when no extension claims `apiTransport`. Kept byte-identical to the legacy
 * `fetchExpr`. In Phase 3 the TanStack-specific layer below moves to a package; this
 * fetcher transport stays in core as the default.
 */
function renderFetcherRequest(req: RequestModel): string {
  return `fetcher.${req.method}<${req.responseType}>(${req.urlExpr}, ${req.optsExpr})`;
}

/**
 * The bundled TanStack client layer (Phase 1: still flag-driven; Phase 3: extracted to
 * `@dudousxd/nestjs-codegen-tanstack`). Wraps a leaf into a handle exposing
 * `fetch`/`queryKey`/`queryOptions`|`mutationOptions`. Returns ordered members.
 */
function tanstackLayerMembers(requestExpr: string, req: RequestModel): Record<string, string> {
  const members: Record<string, string> = {
    fetch: `() => ${requestExpr}`,
    queryKey: `() => ${req.queryKeyExpr}`,
  };
  if (req.isGet) {
    members.queryOptions = `() => _queryOptions({ queryKey: ${req.queryKeyExpr}, queryFn: () => ${requestExpr} })`;
  } else {
    members.mutationOptions = `() => _mutationOptions({ mutationFn: (body: ${req.bodyType}) => fetcher.${req.method}<${req.responseType}>(${req.urlExpr}, { body }) })`;
  }
  return members;
}

/**
 * The bundled nestjs-filter member contributor (Phase 4: extracted to
 * `@dudousxd/nestjs-filter-codegen`). Adds `filterQuery` to handle leaves whose route
 * carries `filterFields`.
 */
function filterMembers(c: LeafEntry): Record<string, string> {
  if (!c.contractSource.filterFields?.length) return {};
  return { filterQuery: `() => _filterQueryTyped<${emitFilterQueryTypeArgs(c)}>()` };
}

/**
 * Render one leaf from its model. A bare callable when `members` is undefined (default
 * fetch); a handle object when a layer contributed members.
 */
function renderLeaf(
  pad: string,
  objKey: string,
  req: RequestModel,
  requestExpr: string,
  members: Record<string, string> | undefined,
): string[] {
  if (!members) {
    return [`${pad}${objKey}: (input?: ${req.inputType}) => ${requestExpr},`];
  }
  const lines = [`${pad}${objKey}: (input?: ${req.inputType}) => ({`];
  for (const [name, value] of Object.entries(members)) {
    lines.push(`${pad}  ${name}: ${value},`);
  }
  lines.push(`${pad}}),`);
  return lines;
}

/**
 * Emit the nested `api` object body via the LeafModel pipeline:
 * build model → transport (fetcher) → layer (TanStack, when `query`) → members (filter)
 * → render. The default (no layer) is a bare typed-fetch callable; `query` flips leaves
 * into TanStack handles.
 */
function emitApiObjectBlock(tree: Map<string, TreeNode>, indent: number, query: boolean): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  for (const [key, node] of tree) {
    const objKey = toObjectKey(key);
    if (node.kind === 'branch') {
      lines.push(`${pad}${objKey}: {`);
      lines.push(...emitApiObjectBlock(node.children, indent + 2, query));
      lines.push(`${pad}},`);
      continue;
    }

    const req = buildRequestModel(node);
    const requestExpr = renderFetcherRequest(req);

    // No client layer → bare callable (Promise). The TanStack layer (gated on `query`)
    // turns the leaf into a handle, then the filter member contributor adds filterQuery.
    let members: Record<string, string> | undefined;
    if (query) {
      members = { ...tanstackLayerMembers(requestExpr, req), ...filterMembers(node) };
    }

    lines.push(...renderLeaf(pad, objKey, req, requestExpr, members));
  }

  return lines;
}

/**
 * Build the ApiRouter type-access chain for a dot-separated name.
 * e.g. 'users.list' -> "ApiRouter['users']['list']"
 */
function buildRouterTypeAccess(name: string): string {
  const segments = splitName(name);
  return `ApiRouter${segments.map((s) => `[${JSON.stringify(s)}]`).join('')}`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

function buildApiFile(
  routes: RouteDescriptor[],
  outDir?: string,
  opts: ApiEmitOptions = {},
): string {
  const fetcherImportPath = opts.fetcherImportPath;
  const inertia = opts.mutationClient !== 'fetcher';
  const queryModule = opts.queryImport ?? '@tanstack/react-query';
  const query = opts.query ?? false;
  const contracted = routes.filter((r) => r.contract);

  // Collect all type refs for import generation
  const importsByFile = new Map<string, Set<string>>();
  for (const r of contracted) {
    const cs = r.contract?.contractSource;
    if (!cs) continue;
    // When controllerRef exists, response uses ReturnType<import(...)> — skip response import
    const refs = r.controllerRef
      ? [cs.queryRef, cs.bodyRef]
      : [cs.queryRef, cs.bodyRef, cs.responseRef];
    for (const ref of refs) {
      if (!ref) continue;
      let names = importsByFile.get(ref.filePath);
      if (!names) {
        names = new Set();
        importsByFile.set(ref.filePath, names);
      }
      names.add(ref.name);
    }
    // Named enum / type-alias / interface refs inferred from @FilterFor method
    // params (the type map M references them by name → emit `import type` too).
    for (const ft of cs.filterFieldTypes ?? []) {
      if (!ft.typeRef) continue;
      let names = importsByFile.get(ft.typeRef.filePath);
      if (!names) {
        names = new Set();
        importsByFile.set(ft.typeRef.filePath, names);
      }
      names.add(ft.typeRef.name);
    }
  }

  const hasGetRoutes = contracted.some((r) => r.method === 'GET');
  const hasMutationRoutes = contracted.some((r) => r.method !== 'GET');
  const hasFilters = contracted.some((r) => r.contract?.contractSource.filterFields?.length);

  const lines: string[] = ['// Generated by @dudousxd/nestjs-codegen. Do not edit.', ''];

  // TanStack Query helpers — only when `query` is enabled (opt-in).
  if (query) {
    const tqImports: string[] = [];
    if (hasGetRoutes || hasFilters) tqImports.push('queryOptions as _queryOptions');
    if (hasMutationRoutes) tqImports.push('mutationOptions as _mutationOptions');
    if (tqImports.length > 0) {
      lines.push(`import { ${tqImports.join(', ')} } from '${queryModule}';`);
    }
    if (hasFilters) {
      lines.push(
        "import { filterQueryTyped as _filterQueryTyped } from '@dudousxd/nestjs-filter-client';",
      );
    }
  }

  // The Inertia router is only needed for the navigate() helper (inertia mode).
  if (inertia) {
    lines.push("import { router } from '@inertiajs/react';");
  }
  lines.push(
    "import { route, ROUTES, type RouteName, type ExtractParams, type RouteParams } from './routes.js';",
  );
  // Tuyau-style: the api is a factory that takes the fetcher at runtime, so the
  // app injects its own client (custom transport/axios, baseUrl, superjson) —
  // rather than the codegen hardcoding `import { fetcher } from '<path>'`.
  const runtimeImport = fetcherImportPath ?? '@dudousxd/nestjs-client';
  lines.push(`import type { Fetcher } from '${runtimeImport}';`);

  // Emit type imports from source files.
  // When two different files export the same type name, alias the duplicate
  // to avoid `Identifier has already been declared` parse errors.
  if (importsByFile.size > 0 && outDir) {
    lines.push('');
    const emittedNames = new Set<string>();
    for (const [filePath, names] of importsByFile) {
      // Bare module specifier (node_modules package) → import as-is. Local
      // source files are always absolute paths → compute a relative import.
      let relPath: string;
      if (isAbsolute(filePath)) {
        relPath = relative(outDir, filePath).replace(/\.ts$/, '');
        if (!relPath.startsWith('.')) relPath = `./${relPath}`;
      } else {
        relPath = filePath;
      }
      const specifiers: string[] = [];
      for (const name of [...names].sort()) {
        if (emittedNames.has(name)) {
          const alias = `${name}_${emittedNames.size}`;
          specifiers.push(`${name} as ${alias}`);
          emittedNames.add(alias);
        } else {
          specifiers.push(name);
          emittedNames.add(name);
        }
      }
      lines.push(`import type { ${specifiers.join(', ')} } from '${relPath}';`);
    }
  }
  lines.push('');

  if (contracted.length === 0) {
    lines.push('export type ApiRouter = Record<string, never>;');
    lines.push('');
    lines.push('export function createApi(_fetcher: Fetcher): Record<string, never> {');
    lines.push('  return {};');
    lines.push('}');
    lines.push('export type Api = ReturnType<typeof createApi>;');
    lines.push('');
    lines.push('export namespace Route {');
    lines.push('  export type Response<K extends string> = never;');
    lines.push('  export type Body<K extends string> = never;');
    lines.push('  export type Query<K extends string> = never;');
    lines.push('  export type Params<K extends string> = never;');
    lines.push('  export type Error<K extends string> = never;');
    lines.push('  export type FilterFields<K extends string> = never;');
    lines.push(
      '  export type Request<K extends string> = { body: never; query: never; params: never };',
    );
    lines.push('}');
    lines.push('');
    lines.push('export namespace Path {');
    lines.push('  export type Response<M extends string, U extends string> = never;');
    lines.push('  export type Body<M extends string, U extends string> = never;');
    lines.push('  export type Query<M extends string, U extends string> = never;');
    lines.push('  export type Params<M extends string, U extends string> = never;');
    lines.push('  export type Error<M extends string, U extends string> = never;');
    lines.push('  export type FilterFields<M extends string, U extends string> = never;');
    lines.push('}');
    lines.push('');
    if (inertia) {
      lines.push('export type NavigateOptions = {');
      lines.push('  method?: string;');
      lines.push('  data?: Record<string, unknown>;');
      lines.push('  preserveState?: boolean;');
      lines.push('  preserveScroll?: boolean;');
      lines.push('  replace?: boolean;');
      lines.push('};');
      lines.push('');
      lines.push('export function navigate(_name: never, _options?: NavigateOptions): void {');
      lines.push('  // No routes available');
      lines.push('}');
      lines.push('');
    }
    return lines.join('\n');
  }

  // Build a nested tree from all contracted routes
  const tree = new Map<string, TreeNode>();

  for (const r of contracted) {
    const c = r.contract!;
    const name: string = r.name;
    const segments = splitName(name);
    // Validate each segment is a valid camelCase identifier
    for (const seg of segments) {
      validateNameSegment(seg, name);
    }
    const leaf: LeafEntry = {
      kind: 'leaf',
      method: r.method,
      name: name,
      path: r.path,
      params: r.params,
      controllerRef: r.controllerRef,
      contractSource: c.contractSource,
    };
    insertIntoTree(tree, segments, leaf, name);
  }

  // --- ApiRouter type ---
  lines.push('export type ApiRouter = {');
  lines.push(...emitRouterTypeBlock(tree, 2, outDir ?? ''));
  lines.push('};');
  lines.push('');

  // --- api factory (inject your fetcher at runtime) ---
  lines.push('export function createApi(fetcher: Fetcher) {');
  lines.push('  return {');
  lines.push(...emitApiObjectBlock(tree, 4, query));
  lines.push('  };');
  lines.push('}');
  lines.push('');
  lines.push('export type Api = ReturnType<typeof createApi>;');
  lines.push('');

  // --- Recursive helper type _RouterAt: walks nested ApiRouter by dot-path ---
  lines.push('type _RouterAt<R, P extends string> = P extends `${infer Head}.${infer Tail}`');
  lines.push('  ? Head extends keyof R ? _RouterAt<R[Head], Tail> : never');
  lines.push('  : P extends keyof R ? R[P] : never;');
  lines.push('');

  // --- ResolveByName: resolve a field from a dot-path name ---
  lines.push(
    'type ResolveByName<K extends string, Field extends string> = _RouterAt<ApiRouter, K> extends infer R ? Field extends keyof R ? R[Field] : never : never;',
  );
  lines.push('');

  // --- ResolveByPath: scan all leaves for matching method + url ---
  // Flattens ApiRouter recursively and finds the entry whose method === M and url === U.
  lines.push('type _LeafValues<T> = T extends { method: string; url: string }');
  lines.push('  ? T');
  lines.push('  : T extends object ? _LeafValues<T[keyof T]> : never;');
  lines.push('');
  lines.push(
    'type ResolveByPath<M extends string, U extends string, Field extends string> = _LeafValues<ApiRouter> extends infer L',
  );
  lines.push('  ? L extends { method: M; url: U }');
  lines.push('    ? Field extends keyof L ? L[Field] : never');
  lines.push('    : never');
  lines.push('  : never;');
  lines.push('');

  // --- Route namespace ---
  lines.push('export namespace Route {');
  lines.push('  export type Response<K extends string> = ResolveByName<K, "response">;');
  lines.push('  export type Body<K extends string> = ResolveByName<K, "body">;');
  lines.push('  export type Query<K extends string> = ResolveByName<K, "query">;');
  lines.push('  export type Params<K extends string> = ResolveByName<K, "params">;');
  lines.push('  export type Error<K extends string> = ResolveByName<K, "error">;');
  lines.push('  export type FilterFields<K extends string> = ResolveByName<K, "filterFields">;');
  lines.push('  export type Request<K extends string> = {');
  lines.push('    body: Body<K>;');
  lines.push('    query: Query<K>;');
  lines.push('    params: Params<K>;');
  lines.push('  };');
  lines.push('}');
  lines.push('');

  // --- Path namespace ---
  lines.push('export namespace Path {');
  lines.push(
    '  export type Response<M extends string, U extends string> = ResolveByPath<M, U, "response">;',
  );
  lines.push(
    '  export type Body<M extends string, U extends string> = ResolveByPath<M, U, "body">;',
  );
  lines.push(
    '  export type Query<M extends string, U extends string> = ResolveByPath<M, U, "query">;',
  );
  lines.push(
    '  export type Params<M extends string, U extends string> = ResolveByPath<M, U, "params">;',
  );
  lines.push(
    '  export type Error<M extends string, U extends string> = ResolveByPath<M, U, "error">;',
  );
  lines.push(
    '  export type FilterFields<M extends string, U extends string> = ResolveByPath<M, U, "filterFields">;',
  );
  lines.push('}');
  lines.push('');

  // --- NavigateOptions + navigate() (Inertia-only; uses router.visit) ---
  if (inertia) {
    lines.push('export type NavigateOptions = {');
    lines.push('  method?: string;');
    lines.push('  data?: Record<string, unknown>;');
    lines.push('  preserveState?: boolean;');
    lines.push('  preserveScroll?: boolean;');
    lines.push('  replace?: boolean;');
    lines.push('};');
    lines.push('');

    // --- navigate() function ---
    lines.push('/**');
    lines.push(' * Type-safe navigation using Inertia router.');
    lines.push(' * Resolves the URL from the named route and calls `router.visit()`.');
    lines.push(' */');
    lines.push('export function navigate<K extends RouteName>(');
    lines.push('  name: K,');
    lines.push('  ...args: ExtractParams<(typeof ROUTES)[K]> extends never');
    lines.push('    ? [options?: NavigateOptions]');
    lines.push('    : [options: { params: RouteParams<K> } & NavigateOptions]');
    lines.push('): void {');
    lines.push(
      '  const [options] = args as [({ params?: Record<string, string> } & NavigateOptions) | undefined];',
    );
    lines.push('  const url = route(name as never, (options as any)?.params as never);');
    lines.push('  const { params: _p, ...visitOptions } = options ?? {} as any;');
    lines.push('  router.visit(url, visitOptions);');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
