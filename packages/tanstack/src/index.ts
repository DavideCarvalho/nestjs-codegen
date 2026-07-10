import type {
  ApiClientLayer,
  ApiHeaderContribution,
  CodegenExtension,
  ExtensionContext,
  LeafModel,
  RequestModel,
} from '@dudousxd/nestjs-codegen/extension';
import { defineExtension, requestShape } from '@dudousxd/nestjs-codegen/extension';

/**
 * `handleQuery` source, emitted verbatim into `api.ts` whenever the TanStack
 * layer is active. Solves two hand-rolled-adapter pain points: (a) a
 * POST-as-query handle (pre-`@AsQuery()`, or any handle shaped like one) and
 * (b) picking between two different handles dynamically — spreading a
 * ternary of `queryOptions()` calls breaks the `useQuery` overload because
 * the two branches' generic instantiations don't unify. `handleQuery` widens
 * any `{ queryKey, fetch }`-shaped handle (every generated leaf has both, via
 * the __req base + the queryKey member this layer adds) into the plain
 * `{ queryKey, queryFn }` pair `useQuery` accepts directly.
 */
const HANDLE_QUERY_HELPER: readonly string[] = [
  '/**',
  ' * For dynamically-picked handles where spreading a ternary of `queryOptions()`',
  ' * breaks the `useQuery` overload. Wraps any `{ queryKey, fetch }`-shaped handle',
  ' * (e.g. a POST-as-query handle, or a runtime pick between two different handles)',
  ' * into a plain `{ queryKey, queryFn }` pair that `useQuery` accepts directly.',
  ' */',
  'export function handleQuery<TData>(handle: {',
  '  queryKey: () => readonly unknown[];',
  '  fetch: () => Promise<TData>;',
  '}): { queryKey: readonly unknown[]; queryFn: () => Promise<TData> } {',
  '  return { queryKey: handle.queryKey(), queryFn: () => handle.fetch() };',
  '}',
];

function apiHeaderHook(): ApiHeaderContribution {
  return { statements: [...HANDLE_QUERY_HELPER] };
}

export interface TanstackQueryOptions {
  /**
   * Module to import `queryOptions`/`mutationOptions` from. Default `@tanstack/react-query`
   * (it re-exports them — no need to install `@tanstack/query-core`). Vue/Svelte/Solid
   * users point this at their own adapter, e.g. `@tanstack/vue-query`.
   * @default '@tanstack/react-query'
   */
  import?: string;
  /**
   * Query-string key appended to each page request in `infiniteQueryOptions()`. This is a
   * generation-time setting because the param name is structural to the API surface (it is
   * baked into the emitted `queryFn` for every GET route) and cannot meaningfully vary
   * per-call. For cursor-style APIs that key the cursor differently, set this (e.g.
   * `'cursor'`). The runtime selector (see {@link InfiniteQueryOverrides}) decides the
   * *value* of the next page param; this names the field it is sent under.
   * @default 'page'
   */
  pageParamName?: string;
}

/** A contracted route counts for import decisions. */
function contracted(ctx: ExtensionContext) {
  return ctx.routes.filter((r) => r.contract);
}

/**
 * TanStack Query client layer. Wraps each generated `api.ts` leaf into a handle exposing
 * `fetch`/`queryKey`/`queryOptions` (GET) or `mutationOptions` (writes), composing with the
 * injected fetcher. Register it via `forRoot({ extensions: [tanstackQuery()] })`.
 */
export function tanstackQuery(options: TanstackQueryOptions = {}): CodegenExtension {
  const queryModule = options.import ?? '@tanstack/react-query';
  const pageParamName = options.pageParamName ?? 'page';

  const layer: ApiClientLayer = {
    name: 'tanstack-query',

    buildMembers(requestExpr: string, leaf: LeafModel): Record<string, string> {
      const req: RequestModel = leaf.request;
      // Binary (blob) routes have no meaningful "next page" — a download isn't
      // paginated data — so they never get an `infiniteQueryOptions` member.
      const isBinary = leaf.route.contract?.contractSource.binaryResponse === true;
      // `fetch` + awaitability come from the core __req base; we add the TanStack helpers.
      const members: Record<string, string> = {
        queryKey: `() => ${req.queryKeyExpr}`,
      };
      // Reads (GET, filter-search, or `@AsQuery()`) get query helpers — this
      // includes binary GET/`@AsQuery()` routes, whose `queryFn` resolves to
      // `RawResponse<Blob>` (the response type the route carries through).
      if (req.isQuery) {
        members.queryOptions = `() => _queryOptions({ queryKey: ${req.queryKeyExpr}, queryFn: () => ${requestExpr} })`;
      }
      // ...page/cursor pagination is GET-only (it appends the page param to the query
      // string). The emitted member takes an optional `overrides` arg so a consumer can plug
      // their own cursor selector — mirroring how Orval/tRPC expose `getNextPageParam` as a
      // call-site option. Defaults (page param value, initialPageParam, and the
      // `meta.{page,lastPage}` selector) are kept so existing output keeps working unchanged.
      if (req.isGet && !isBinary) {
        const resp = req.responseType;
        // Runtime overrides: any TanStack infinite-query option, spread last so it wins; the
        // three pagination-shaping fields are read explicitly so callers can override just
        // the selector while keeping every other default.
        const overridesType = `{ getNextPageParam?: (lastPage: ${resp}, allPages: ${resp}[], lastPageParam: number, allPageParams: number[]) => number | null | undefined; getPreviousPageParam?: (firstPage: ${resp}, allPages: ${resp}[], firstPageParam: number, allPageParams: number[]) => number | null | undefined; initialPageParam?: number; [key: string]: unknown }`;
        const defaultNext = `(lastPage: ${resp}) => { const meta = (lastPage as unknown as { meta?: { page?: number; lastPage?: number } })?.meta; if (meta?.page != null && meta?.lastPage != null) { return meta.page < meta.lastPage ? meta.page + 1 : undefined; } return undefined; }`;
        members.infiniteQueryOptions = `(overrides?: ${overridesType}) => _infiniteQueryOptions({ queryKey: ${req.queryKeyExpr}, queryFn: ({ pageParam }: { pageParam: number }) => fetcher.${req.method}<${resp}>(${req.urlExpr}, { query: { ...(input?.query ?? {}), ${pageParamName}: pageParam } as Record<string, unknown> }), initialPageParam: overrides?.initialPageParam ?? 1, getNextPageParam: overrides?.getNextPageParam ?? (${defaultNext}), getPreviousPageParam: overrides?.getPreviousPageParam, ...overrides })`;
      }
      // ...and any non-GET (incl. filter-search POSTs) also gets a mutation entry. The
      // mutationFn takes the full leaf input ({ params?, query?, body? }) so path params
      // can be supplied dynamically at mutate() time, not just at the leaf call.
      if (!req.isGet) {
        members.mutationOptions = `() => _mutationOptions({ mutationFn: (input?: ${req.inputType}) => ${requestExpr} })`;
      }
      return members;
    },

    imports(ctx: ExtensionContext): string[] {
      const routes = contracted(ctx);
      const shapes = routes.map(requestShape);
      const hasQuery = shapes.some((s) => s.isQuery);
      const hasMutation = shapes.some((s) => !s.isGet);
      // `infiniteQueryOptions` is imported only when a non-binary GET route
      // exists — binary (blob) routes never get an infinite-query member (see
      // buildMembers), so a route set that is entirely binary shouldn't pull it in.
      const hasInfiniteGet = routes.some(
        (r, i) => shapes[i]?.isGet && r.contract?.contractSource.binaryResponse !== true,
      );

      const named: string[] = [];
      if (hasQuery) named.push('queryOptions as _queryOptions');
      if (hasInfiniteGet) named.push('infiniteQueryOptions as _infiniteQueryOptions');
      if (hasMutation) named.push('mutationOptions as _mutationOptions');
      if (named.length === 0) return [];
      return [`import { ${named.join(', ')} } from '${queryModule}';`];
    },
  };

  return defineExtension({
    name: 'tanstack-query',
    apiClientLayer: layer,
    apiHeader: apiHeaderHook,
  });
}

export default tanstackQuery;
