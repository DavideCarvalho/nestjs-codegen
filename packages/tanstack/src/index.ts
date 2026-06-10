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
    },

    imports(ctx: ExtensionContext): string[] {
      const routes = contracted(ctx);
      const hasGet = routes.some((r) => r.method === 'GET');
      const hasMutation = routes.some((r) => r.method !== 'GET');
      // Compat: a filter route pulls in queryOptions too (matches the pre-extraction
      // emitter). Revisit when the filter extension owns its own imports.
      const hasFilters = routes.some((r) => r.contract?.contractSource.filterFields?.length);

      const named: string[] = [];
      if (hasGet || hasFilters) named.push('queryOptions as _queryOptions');
      if (hasMutation) named.push('mutationOptions as _mutationOptions');
      if (named.length === 0) return [];
      return [`import { ${named.join(', ')} } from '${queryModule}';`];
    },
  };

  return defineExtension({ name: 'tanstack-query', apiClientLayer: layer });
}

export default tanstackQuery;
