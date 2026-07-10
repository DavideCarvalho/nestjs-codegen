import type { ExtensionContext, LeafModel, RequestModel } from '@dudousxd/nestjs-codegen/extension';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { tanstackQuery } from '../src/index.js';

function req(over: Partial<RequestModel> = {}): RequestModel {
  return {
    routeName: 'users.show',
    method: 'get',
    isGet: true,
    isQuery: true,
    hasParams: true,
    hasBody: false,
    inputType: "{ params: ApiRouter['users']['show']['params'] }",
    urlExpr: "route('users.show', input?.params) || '/api/users/:id'",
    optsExpr: '{ query: input?.query as Record<string, unknown> | undefined }',
    responseType: "ApiRouter['users']['show']['response']",
    queryKeyExpr: '["users.show", input] as const',
    ...over,
  };
}

const leaf = (r: RequestModel, binaryResponse = false): LeafModel => ({
  route: (binaryResponse
    ? { contract: { contractSource: { binaryResponse: true } } }
    : {}) as never,
  request: r,
  requestExpr: '',
});

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

  it('GET leaf gets queryKey/queryOptions/infiniteQueryOptions (fetch + await come from __req)', () => {
    const r = req();
    const members = tanstackQuery().apiClientLayer!.buildMembers(
      'fetcher.get<R>(u, o)',
      leaf(r),
      {} as never,
    );
    expect(Object.keys(members)).toEqual(['queryKey', 'queryOptions', 'infiniteQueryOptions']);
    expect(members.queryOptions).toContain(
      '_queryOptions({ queryKey: ["users.show", input] as const',
    );
    expect(members.infiniteQueryOptions).toContain('_infiniteQueryOptions(');
    expect(members.infiniteQueryOptions).toContain(
      'initialPageParam: overrides?.initialPageParam ?? 1',
    );
  });

  it('plain mutation (POST, no filter) gets queryKey/mutationOptions only', () => {
    const r = req({ method: 'post', isGet: false, isQuery: false, hasBody: true });
    const members = tanstackQuery().apiClientLayer!.buildMembers(
      'fetcher.post<R>(u, o)',
      leaf(r),
      {} as never,
    );
    expect(Object.keys(members)).toEqual(['queryKey', 'mutationOptions']);
  });

  it('filter-search (POST + filterFields) gets BOTH queryOptions and mutationOptions', () => {
    const r = req({ method: 'post', isGet: false, isQuery: true, hasBody: true });
    const members = tanstackQuery().apiClientLayer!.buildMembers(
      'fetcher.post<R>(u, o)',
      leaf(r),
      {} as never,
    );
    expect(Object.keys(members)).toEqual(['queryKey', 'queryOptions', 'mutationOptions']);
  });

  describe('binary (blob) routes', () => {
    it('binary GET gets queryKey/queryOptions but NOT infiniteQueryOptions', () => {
      const r = req(); // GET, isQuery: true
      const members = tanstackQuery().apiClientLayer!.buildMembers(
        'fetcher.fetchBlob(u, o)',
        leaf(r, true),
        {} as never,
      );
      expect(Object.keys(members)).toEqual(['queryKey', 'queryOptions']);
    });

    it('binary POST gets queryKey/mutationOptions only, same as any other non-GET route', () => {
      const r = req({ method: 'post', isGet: false, isQuery: false, hasBody: true });
      const members = tanstackQuery().apiClientLayer!.buildMembers(
        'fetcher.fetchBlob(u, o)',
        leaf(r, true),
        {} as never,
      );
      expect(Object.keys(members)).toEqual(['queryKey', 'mutationOptions']);
    });

    it('imports() omits infiniteQueryOptions when every GET route is binary', () => {
      const layer = tanstackQuery().apiClientLayer!;
      const ctx: ExtensionContext = {
        cwd: '',
        outDir: '',
        config: {} as never,
        project: () => {
          throw new Error('unused');
        },
        routes: [
          {
            method: 'GET',
            path: '/x',
            name: 'x',
            params: [],
            contract: {
              contractSource: { query: null, body: null, response: 'X', binaryResponse: true },
            },
          },
        ] as never,
      };
      expect(layer.imports?.(ctx)).toEqual([
        "import { queryOptions as _queryOptions } from '@tanstack/react-query';",
      ]);
    });

    it('imports() still includes infiniteQueryOptions when a non-binary GET route also exists', () => {
      const layer = tanstackQuery().apiClientLayer!;
      const ctx: ExtensionContext = {
        cwd: '',
        outDir: '',
        config: {} as never,
        project: () => {
          throw new Error('unused');
        },
        routes: [
          {
            method: 'GET',
            path: '/x',
            name: 'x',
            params: [],
            contract: {
              contractSource: { query: null, body: null, response: 'X', binaryResponse: true },
            },
          },
          {
            method: 'GET',
            path: '/y',
            name: 'y',
            params: [],
            contract: { contractSource: { query: null, body: null, response: 'Y' } },
          },
        ] as never,
      };
      expect(layer.imports?.(ctx)).toEqual([
        "import { queryOptions as _queryOptions, infiniteQueryOptions as _infiniteQueryOptions } from '@tanstack/react-query';",
      ]);
    });
  });

  describe('apiHeader: handleQuery helper', () => {
    it('is contributed as a top-level statement', () => {
      const ext = tanstackQuery();
      const contribution = ext.apiHeader?.({} as never);
      expect(contribution?.statements?.join('\n')).toContain(
        'export function handleQuery<TData>(handle: {',
      );
    });

    it('wraps a { queryKey, fetch } handle into { queryKey, queryFn }', () => {
      const ext = tanstackQuery();
      const source = ext.apiHeader?.({} as never)?.statements?.join('\n') ?? '';
      // Transpile the emitted TS (an `export function` statement) to CommonJS so it can be
      // evaluated directly — exercising the actual emitted source, not a hand-copy of it.
      const js = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
      }).outputText;
      const handleQuery = new Function('exports', `${js}\nreturn exports.handleQuery;`)({}) as <
        TData,
      >(handle: {
        queryKey: () => readonly unknown[];
        fetch: () => Promise<TData>;
      }) => { queryKey: readonly unknown[]; queryFn: () => Promise<TData> };
      const result = handleQuery({
        queryKey: () => ['x'] as const,
        fetch: () => Promise.resolve('ok'),
      });
      expect(result.queryKey).toEqual(['x']);
      return expect(result.queryFn()).resolves.toBe('ok');
    });
  });

  it('imports only what the routes use, from the configured module', () => {
    const layer = tanstackQuery({ import: '@tanstack/vue-query' }).apiClientLayer!;
    expect(layer.imports?.(ctxWith([{ method: 'GET' }]))).toEqual([
      "import { queryOptions as _queryOptions, infiniteQueryOptions as _infiniteQueryOptions } from '@tanstack/vue-query';",
    ]);
    expect(layer.imports?.(ctxWith([{ method: 'POST' }]))).toEqual([
      "import { mutationOptions as _mutationOptions } from '@tanstack/vue-query';",
    ]);
    expect(layer.imports?.(ctxWith([{ method: 'GET' }, { method: 'POST' }]))).toEqual([
      "import { queryOptions as _queryOptions, infiniteQueryOptions as _infiniteQueryOptions, mutationOptions as _mutationOptions } from '@tanstack/vue-query';",
    ]);
  });

  it('a filter-search POST imports both queryOptions and mutationOptions', () => {
    const layer = tanstackQuery().apiClientLayer!;
    expect(layer.imports?.(ctxWith([{ method: 'POST', filterFields: ['status'] }]))).toEqual([
      "import { queryOptions as _queryOptions, mutationOptions as _mutationOptions } from '@tanstack/react-query';",
    ]);
  });

  describe('infiniteQueryOptions cursor/pagination selector', () => {
    it('defaults: page param "page", initialPageParam 1, and meta.page/lastPage selector', () => {
      const members = tanstackQuery().apiClientLayer!.buildMembers(
        'fetcher.get<R>(u, o)',
        leaf(req()),
        {} as never,
      );
      const io = members.infiniteQueryOptions;
      // Backward-compatible: still a zero-arg-callable handle member, defaults baked in.
      expect(io).toContain('initialPageParam: overrides?.initialPageParam ?? 1');
      expect(io).toContain('page: pageParam');
      // Default selector reads meta.page / meta.lastPage.
      expect(io).toContain('meta?.page != null && meta?.lastPage != null');
      expect(io).toContain('meta.page < meta.lastPage ? meta.page + 1 : undefined');
    });

    it('accepts a runtime overrides arg (getNextPageParam / getPreviousPageParam / initialPageParam)', () => {
      const members = tanstackQuery().apiClientLayer!.buildMembers(
        'fetcher.get<R>(u, o)',
        leaf(req()),
        {} as never,
      );
      const io = members.infiniteQueryOptions;
      // The emitted member is now a function that takes an optional overrides object.
      expect(io).toMatch(/^\(overrides\?:/);
      // Caller-provided selectors win over the defaults.
      expect(io).toContain('getNextPageParam: overrides?.getNextPageParam ??');
      expect(io).toContain('getPreviousPageParam: overrides?.getPreviousPageParam');
      expect(io).toContain('...overrides');
    });

    // Behavioral checks: transpile the emitted TS expression to JS with the real TypeScript
    // compiler, then evaluate it with a stub `_infiniteQueryOptions` (identity over its
    // config) plus stub `input`/`fetcher`. This exercises the actual emitted pagination
    // logic — and also proves the emitted member is valid, compilable TypeScript.
    function evalInfinite(memberExpr: string) {
      const js = ts.transpileModule(`const __member = ${memberExpr};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
      }).outputText;
      const _infiniteQueryOptions = (cfg: Record<string, unknown>) => cfg;
      const fetcher = { get: () => Promise.resolve({}) };
      const input = { query: {} };
      const make = new Function(
        '_infiniteQueryOptions',
        'fetcher',
        'input',
        `${js}; return __member;`,
      )(_infiniteQueryOptions, fetcher, input) as (overrides?: Record<string, unknown>) => {
        getNextPageParam: (p: unknown) => unknown;
        initialPageParam: number;
      };
      return make;
    }

    it('default selector: meta.page < meta.lastPage advances; otherwise stops', () => {
      const member = tanstackQuery().apiClientLayer!.buildMembers(
        'fetcher.get<R>(u, o)',
        leaf(req()),
        {} as never,
      ).infiniteQueryOptions;
      const cfg = evalInfinite(member)();
      expect(cfg.initialPageParam).toBe(1);
      expect(cfg.getNextPageParam({ meta: { page: 1, lastPage: 3 } })).toBe(2);
      expect(cfg.getNextPageParam({ meta: { page: 3, lastPage: 3 } })).toBeUndefined();
    });

    it('custom getNextPageParam overrides the default', () => {
      const member = tanstackQuery().apiClientLayer!.buildMembers(
        'fetcher.get<R>(u, o)',
        leaf(req()),
        {} as never,
      ).infiniteQueryOptions;
      const cfg = evalInfinite(member)({
        getNextPageParam: (last: { nextCursor?: number }) => last.nextCursor,
        initialPageParam: 0,
      });
      expect(cfg.initialPageParam).toBe(0);
      expect(cfg.getNextPageParam({ nextCursor: 42 })).toBe(42);
    });

    it('non-standard shape no longer silently breaks when a selector is given', () => {
      const member = tanstackQuery().apiClientLayer!.buildMembers(
        'fetcher.get<R>(u, o)',
        leaf(req()),
        {} as never,
      ).infiniteQueryOptions;
      // No `meta` field at all — default would return undefined (the footgun). A custom
      // selector lets the caller drive pagination from the real shape.
      const def = evalInfinite(member)();
      expect(def.getNextPageParam({ pagination: { next: 'abc' } })).toBeUndefined();
      const cfg = evalInfinite(member)({
        getNextPageParam: (last: { pagination?: { next?: string } }) => last.pagination?.next,
      });
      expect(cfg.getNextPageParam({ pagination: { next: 'abc' } })).toBe('abc');
    });

    it('generation-time pageParamName customizes the query-string key', () => {
      const members = tanstackQuery({ pageParamName: 'cursor' }).apiClientLayer!.buildMembers(
        'fetcher.get<R>(u, o)',
        leaf(req()),
        {} as never,
      );
      const io = members.infiniteQueryOptions;
      expect(io).toContain('cursor: pageParam');
      expect(io).not.toContain('page: pageParam');
    });
  });
});
