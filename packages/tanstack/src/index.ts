import type {
  ApiClientLayer,
  CodegenExtension,
  ExtensionContext,
  LeafModel,
  RequestModel,
} from '@dudousxd/nestjs-codegen/extension';
import { defineExtension } from '@dudousxd/nestjs-codegen/extension';

export interface TanstackQueryOptions {
  /**
   * Module to import `queryOptions`/`mutationOptions` from. Default `@tanstack/react-query`
   * (it re-exports them — no need to install `@tanstack/query-core`). Vue/Svelte/Solid
   * users point this at their own adapter, e.g. `@tanstack/vue-query`.
   * @default '@tanstack/react-query'
   */
  import?: string;
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

  const layer: ApiClientLayer = {
    name: 'tanstack-query',

    buildMembers(requestExpr: string, leaf: LeafModel): Record<string, string> {
      const req: RequestModel = leaf.request;
      // `fetch` + awaitability come from the core __req base; we add the TanStack helpers.
      const members: Record<string, string> = {
        queryKey: `() => ${req.queryKeyExpr}`,
      };
      // Reads (GET or filter-search) get query helpers...
      if (req.isQuery) {
        members.queryOptions = `() => _queryOptions({ queryKey: ${req.queryKeyExpr}, queryFn: () => ${requestExpr} })`;
      }
      // ...page pagination is GET-only (it appends `page` to the query string).
      if (req.isGet) {
        members.infiniteQueryOptions = `() => _infiniteQueryOptions({ queryKey: ${req.queryKeyExpr}, queryFn: ({ pageParam }: { pageParam: number }) => fetcher.${req.method}<${req.responseType}>(${req.urlExpr}, { query: { ...(input?.query ?? {}), page: pageParam } as Record<string, unknown> }), initialPageParam: 1, getNextPageParam: (lastPage: ${req.responseType}) => { const meta = (lastPage as unknown as { meta?: { page?: number; lastPage?: number } })?.meta; if (meta?.page != null && meta?.lastPage != null) { return meta.page < meta.lastPage ? meta.page + 1 : undefined; } return undefined; } })`;
      }
      // ...and any non-GET (incl. filter-search POSTs) also gets a mutation entry.
      if (!req.isGet) {
        members.mutationOptions = `() => _mutationOptions({ mutationFn: (body: ${req.bodyType}) => fetcher.${req.method}<${req.responseType}>(${req.urlExpr}, { body }) })`;
      }
      return members;
    },

    imports(ctx: ExtensionContext): string[] {
      const routes = contracted(ctx);
      const hasGet = routes.some((r) => r.method === 'GET');
      const hasQuery = routes.some(
        (r) => r.method === 'GET' || r.contract?.contractSource.filterFields?.length,
      );
      const hasMutation = routes.some((r) => r.method !== 'GET');

      const named: string[] = [];
      if (hasQuery) named.push('queryOptions as _queryOptions');
      if (hasGet) named.push('infiniteQueryOptions as _infiniteQueryOptions');
      if (hasMutation) named.push('mutationOptions as _mutationOptions');
      if (named.length === 0) return [];
      return [`import { ${named.join(', ')} } from '${queryModule}';`];
    },
  };

  return defineExtension({ name: 'tanstack-query', apiClientLayer: layer });
}

export default tanstackQuery;
