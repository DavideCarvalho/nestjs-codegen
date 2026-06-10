import type { ExtensionContext, LeafModel, RequestModel } from '@dudousxd/nestjs-codegen/extension';
import { describe, expect, it } from 'vitest';
import { tanstackQuery } from '../src/index.js';

function req(over: Partial<RequestModel> = {}): RequestModel {
  return {
    routeName: 'users.show',
    method: 'get',
    isGet: true,
    hasParams: true,
    hasBody: false,
    inputType: "{ params: ApiRouter['users']['show']['params'] }",
    urlExpr: "route('users.show', input?.params) || '/api/users/:id'",
    optsExpr: '{ query: input?.query as Record<string, unknown> | undefined }',
    responseType: "ApiRouter['users']['show']['response']",
    bodyType: "ApiRouter['users']['show']['body']",
    queryKeyExpr: '["users.show", input] as const',
    ...over,
  };
}

const leaf = (r: RequestModel): LeafModel => ({ route: {} as never, request: r, requestExpr: '' });

function ctxWith(routes: Array<{ method: string; filterFields?: string[] }>): ExtensionContext {
  return {
    cwd: '',
    outDir: '',
    config: {} as never,
    project: () => {
      throw new Error('unused');
    },
    routes: routes.map((r) => ({
      method: r.method,
      path: '/x',
      name: 'x',
      params: [],
      contract: {
        contractSource: {
          query: null,
          body: null,
          response: 'X',
          ...(r.filterFields ? { filterFields: r.filterFields } : {}),
        },
      },
    })) as never,
  };
}

describe('tanstackQuery', () => {
  it('declares an apiClientLayer named tanstack-query', () => {
    const ext = tanstackQuery();
    expect(ext.name).toBe('tanstack-query');
    expect(ext.apiClientLayer?.name).toBe('tanstack-query');
  });

  it('GET leaf gets fetch/queryKey/queryOptions', () => {
    const r = req();
    const members = tanstackQuery().apiClientLayer!.buildMembers(
      'fetcher.get<R>(u, o)',
      leaf(r),
      {} as never,
    );
    expect(Object.keys(members)).toEqual(['fetch', 'queryKey', 'queryOptions']);
    expect(members.fetch).toBe('() => fetcher.get<R>(u, o)');
    expect(members.queryOptions).toContain(
      '_queryOptions({ queryKey: ["users.show", input] as const',
    );
  });

  it('mutation leaf gets fetch/queryKey/mutationOptions with a typed body', () => {
    const r = req({ method: 'post', isGet: false, hasBody: true });
    const members = tanstackQuery().apiClientLayer!.buildMembers(
      'fetcher.post<R>(u, o)',
      leaf(r),
      {} as never,
    );
    expect(Object.keys(members)).toEqual(['fetch', 'queryKey', 'mutationOptions']);
    expect(members.mutationOptions).toContain(
      "mutationFn: (body: ApiRouter['users']['show']['body'])",
    );
  });

  it('imports only what the routes use, from the configured module', () => {
    const layer = tanstackQuery({ import: '@tanstack/vue-query' }).apiClientLayer!;
    expect(layer.imports?.(ctxWith([{ method: 'GET' }]))).toEqual([
      "import { queryOptions as _queryOptions } from '@tanstack/vue-query';",
    ]);
    expect(layer.imports?.(ctxWith([{ method: 'POST' }]))).toEqual([
      "import { mutationOptions as _mutationOptions } from '@tanstack/vue-query';",
    ]);
    expect(layer.imports?.(ctxWith([{ method: 'GET' }, { method: 'POST' }]))).toEqual([
      "import { queryOptions as _queryOptions, mutationOptions as _mutationOptions } from '@tanstack/react-query';".replace(
        '@tanstack/react-query',
        '@tanstack/vue-query',
      ),
    ]);
  });

  it('a filter-only mutation route still pulls in queryOptions (parity with the legacy emitter)', () => {
    const layer = tanstackQuery().apiClientLayer!;
    expect(layer.imports?.(ctxWith([{ method: 'POST', filterFields: ['status'] }]))).toEqual([
      "import { queryOptions as _queryOptions, mutationOptions as _mutationOptions } from '@tanstack/react-query';",
    ]);
  });
});
