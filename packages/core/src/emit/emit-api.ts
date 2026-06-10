import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type {
  ContractSource,
  ControllerRef,
  FieldTypeKind,
  FilterFieldType,
  RouteDescriptor,
} from '../discovery/types.js';
import { resolveApiSlots } from '../extension/registry.js';
import type {
  ApiClientLayer,
  ApiTransport,
  CodegenExtension,
  ExtensionContext,
  LeafModel,
  RequestModel,
} from '../extension/types.js';

/**
 * Emits `api.ts` into `outDir` for all routes that carry a `.contract`.
 *
 * By default each leaf is a bare typed-fetch callable. Registered extensions shape the
 * output: an `apiClientLayer` (e.g. `@dudousxd/nestjs-codegen-tanstack`) turns leaves into
 * handles; an `apiTransport` changes how requests are issued; `apiMembers` add handle
 * members; `apiHeader` contributes top-level imports/statements.
 */
export interface ApiEmitOptions {
  fetcherImportPath?: string;
  /** Registered extensions. Their api.ts hooks (transport/layer/members/header) are applied. */
  extensions?: CodegenExtension[];
  /** Shared extension context (from `generate()`). When omitted, a minimal one is built from routes. */
  ctx?: ExtensionContext;
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
 * The `__req` runtime helper, emitted once per `api.ts`. Wraps a request thunk into an
 * **awaitable handle**: `await api.x.y({...})` runs the fetch (Tuyau-style), memoized so
 * repeated awaits hit the network once. Client-layer extensions (e.g. TanStack) spread
 * extra members (`queryOptions`/`mutationOptions`/…) onto the same handle.
 */
function emitReqHelper(): string[] {
  return [
    '/** Awaitable request handle. `await api.x.y({...})` runs the fetch; extensions add query/mutation helpers. */',
    'type __Req<R> = {',
    '  then<T1 = R, T2 = never>(',
    '    onfulfilled?: ((value: R) => T1 | PromiseLike<T1>) | null,',
    '    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,',
    '  ): Promise<T1 | T2>;',
    '  catch<T = never>(onrejected?: ((reason: unknown) => T | PromiseLike<T>) | null): Promise<R | T>;',
    '  finally(onfinally?: (() => void) | null): Promise<R>;',
    '  fetch(): Promise<R>;',
    '};',
    'function __req<R>(run: () => Promise<R>): __Req<R> {',
    '  let __p: Promise<R> | undefined;',
    '  const __promise = () => {',
    '    __p ??= run();',
    '    return __p;',
    '  };',
    '  return {',
    '    then: (onfulfilled, onrejected) => __promise().then(onfulfilled, onrejected),',
    '    catch: (onrejected) => __promise().catch(onrejected),',
    '    finally: (onfinally) => __promise().finally(onfinally),',
    '    fetch: run,',
    '  };',
    '}',
    '',
  ];
}

/**
 * Render one leaf. Every leaf is an **awaitable handle**: the `__req(...)` base makes
 * `await api.x.y({...})` perform the request; any client-layer/member contributions
 * (TanStack options, filterQuery, …) are spread on alongside it.
 */
function renderLeaf(
  pad: string,
  objKey: string,
  req: RequestModel,
  requestExpr: string,
  members: Record<string, string>,
): string[] {
  const lines = [`${pad}${objKey}: (input?: ${req.inputType}) => ({`];
  lines.push(`${pad}  ...__req<${req.responseType}>(() => ${requestExpr}),`);
  for (const [name, value] of Object.entries(members)) {
    lines.push(`${pad}  ${name}: ${value},`);
  }
  lines.push(`${pad}}),`);
  return lines;
}

/** Resolved api.ts pipeline pieces, threaded through the recursive emit. */
interface ApiPipeline {
  transport?: ApiTransport;
  layer?: ApiClientLayer;
  memberExts: CodegenExtension[];
  ctx: ExtensionContext;
}

/**
 * Emit the nested `api` object body via the LeafModel pipeline:
 * build model → transport (default fetcher) → layer (when a client layer is registered)
 * → member contributors (bundled filter + extensions' apiMembers) → render. With no layer
 * a leaf is a bare typed-fetch callable; a layer flips it into a handle.
 */
function emitApiObjectBlock(tree: Map<string, TreeNode>, indent: number, p: ApiPipeline): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  for (const [key, node] of tree) {
    const objKey = toObjectKey(key);
    if (node.kind === 'branch') {
      lines.push(`${pad}${objKey}: {`);
      lines.push(...emitApiObjectBlock(node.children, indent + 2, p));
      lines.push(`${pad}},`);
      continue;
    }

    const req = buildRequestModel(node);
    // Reconstruct a RouteDescriptor view for extension hooks. The tree only retains the
    // LeafEntry (params typed as `source: string`), so cast back to the canonical shape.
    const route = {
      method: node.method,
      path: node.path,
      name: node.name,
      params: node.params,
      contract: { contractSource: node.contractSource },
      ...(node.controllerRef ? { controllerRef: node.controllerRef } : {}),
    } as unknown as RouteDescriptor;
    const leaf: LeafModel = { route, request: req, requestExpr: '' };
    leaf.requestExpr = p.transport
      ? p.transport.renderRequest(leaf, p.ctx)
      : renderFetcherRequest(req);

    // Every leaf is an awaitable handle (the __req base). A client layer (TanStack) spreads
    // query/mutation helpers on top; extension apiMembers (e.g. nestjs-filter's filterQuery)
    // add further members. Member-name collisions across extensions are an error.
    const members: Record<string, string> = {};
    if (p.layer) Object.assign(members, p.layer.buildMembers(leaf.requestExpr, leaf, p.ctx));
    for (const ext of p.memberExts) {
      const extra = ext.apiMembers?.(leaf, p.ctx);
      if (!extra) continue;
      for (const [name, value] of Object.entries(extra)) {
        if (name in members) {
          throw new Error(
            `api member "${name}" on route "${req.routeName}" is contributed by more than one extension (conflict at "${ext.name}").`,
          );
        }
        members[name] = value;
      }
    }

    lines.push(...renderLeaf(pad, objKey, req, leaf.requestExpr, members));
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
  const extensions = opts.extensions ?? [];
  const { transport, layer } = resolveApiSlots(extensions);
  const memberExts = extensions.filter((e) => e.apiMembers);
  const headerExts = extensions.filter((e) => e.apiHeader);
  const contracted = routes.filter((r) => r.contract);

  // Extension context for the api.ts hooks. `generate()` passes the real one; standalone
  // `emitApi` calls (tests) get a minimal context exposing the routes (all the bundled
  // layer/transport read). `project()` is unavailable in the standalone path.
  const ctx: ExtensionContext =
    opts.ctx ??
    ({
      cwd: outDir ?? '',
      outDir: outDir ?? '',
      routes,
      config: {} as never,
      project: () => {
        throw new Error('ExtensionContext.project() is unavailable in standalone emitApi.');
      },
    } satisfies ExtensionContext);

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

  const lines: string[] = ['// Generated by @dudousxd/nestjs-codegen. Do not edit.', ''];

  // Extension-contributed module imports (transport + client layer + apiHeader), deduped
  // and emitted in order. e.g. the TanStack layer emits its queryOptions/mutationOptions
  // import here.
  const extImports: string[] = [];
  const seenImports = new Set<string>();
  const pushImport = (imp: string): void => {
    if (seenImports.has(imp)) return;
    seenImports.add(imp);
    extImports.push(imp);
  };
  for (const imp of transport?.imports?.(ctx) ?? []) pushImport(imp);
  for (const imp of layer?.imports?.(ctx) ?? []) pushImport(imp);
  for (const ext of headerExts) {
    for (const imp of ext.apiHeader?.(ctx)?.imports ?? []) pushImport(imp);
  }
  lines.push(...extImports);

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

  // --- awaitable request handle helper ---
  lines.push(...emitReqHelper());

  // --- api factory (inject your fetcher at runtime) ---
  lines.push('export function createApi(fetcher: Fetcher) {');
  lines.push('  return {');
  lines.push(
    ...emitApiObjectBlock(tree, 4, {
      ...(transport ? { transport } : {}),
      ...(layer ? { layer } : {}),
      memberExts,
      ctx,
    }),
  );
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

  // Extension-contributed top-level statements (e.g. the Inertia extension's navigate()).
  for (const ext of headerExts) {
    const statements = ext.apiHeader?.(ctx)?.statements;
    if (statements?.length) {
      lines.push(...statements, '');
    }
  }

  return lines.join('\n');
}
