import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import { emitApi } from '../../src/emit/emit-api.js';

const routes: RouteDescriptor[] = [
  {
    method: 'GET',
    path: '/api/users',
    name: 'users.list',
    params: [],
    contract: {
      contractSource: { query: '{ active?: boolean }', body: null, response: 'User[]' },
    },
  },
  {
    method: 'POST',
    path: '/api/users',
    name: 'users.create',
    params: [],
    contract: {
      contractSource: { query: null, body: '{ name: string }', response: 'User' },
    },
  },
  {
    method: 'GET',
    path: '/api/admin/users',
    name: 'admin.users.list',
    params: [],
    contract: { contractSource: { query: null, body: null, response: 'User[]' } },
  },
  {
    method: 'POST',
    path: '/api/pipeline-runs/search',
    name: 'pipelineRuns.search',
    params: [],
    contract: {
      contractSource: {
        query: null,
        body: null,
        response: '{ data: User[] }',
        filterFields: ['status', 'name'],
      },
    },
  },
];

describe('emitApi', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'codegen-emit-api-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  async function gen(query?: boolean): Promise<string> {
    await emitApi(routes, outDir, query ? { extensions: [tanstackQuery()] } : {});
    return readFile(join(outDir, 'api.ts'), 'utf8');
  }

  describe('default (no tanstack): leaves are awaitable fetch handles', () => {
    it('no TanStack import or helpers', async () => {
      const c = await gen();
      expect(c).not.toContain('@tanstack');
      expect(c).not.toContain('_queryOptions');
      expect(c).not.toContain('_mutationOptions');
    });

    it('exposes createApi(fetcher) factory + the Fetcher type import + the __req helper', async () => {
      const c = await gen();
      expect(c).toContain('export function createApi(fetcher: Fetcher)');
      expect(c).toContain("import type { Fetcher } from '@dudousxd/nestjs-client'");
      expect(c).toContain('function __req<R>(run: () => Promise<R>)');
    });

    it('GET leaf is an awaitable handle backed by fetcher.get', async () => {
      const c = await gen();
      expect(c).toContain('list: (input?:');
      expect(c).toContain('...__req<');
      expect(c).toContain('() => fetcher.get<');
    });

    it('POST leaf is an awaitable handle backed by fetcher.post', async () => {
      const c = await gen();
      expect(c).toContain('create: (input?:');
      expect(c).toContain('() => fetcher.post<');
    });

    it('a plain POST leaf does NOT pass multipart to the fetcher', async () => {
      const c = await gen();
      expect(c).not.toContain('multipart: true');
    });

    it('a multipart POST leaf passes multipart: true to the fetcher', async () => {
      const multipartRoutes: RouteDescriptor[] = [
        {
          method: 'POST',
          path: '/upload',
          name: 'files.upload',
          params: [],
          contract: {
            contractSource: {
              query: null,
              body: '{ type: string } & { file: File | Blob }',
              response: '{ ok: boolean }',
              multipart: true,
            },
          },
        },
      ];
      await emitApi(multipartRoutes, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).toContain('() => fetcher.post<');
      expect(c).toContain('multipart: true');
    });

    it('nests by dotted name (api.admin.users.list)', async () => {
      const c = await gen();
      expect(c).toContain('admin: {');
      expect(c).toContain('users: {');
    });
  });

  describe('with tanstack: handles also expose TanStack helpers', () => {
    it('imports queryOptions/infiniteQueryOptions/mutationOptions from @tanstack/react-query', async () => {
      const c = await gen(true);
      expect(c).toContain("from '@tanstack/react-query'");
      expect(c).toContain('queryOptions as _queryOptions');
      expect(c).toContain('infiniteQueryOptions as _infiniteQueryOptions');
      expect(c).toContain('mutationOptions as _mutationOptions');
    });

    it('GET handle is awaitable AND exposes queryKey + queryOptions + infiniteQueryOptions', async () => {
      const c = await gen(true);
      expect(c).toContain('list: (input?:');
      expect(c).toContain('...__req<'); // still awaitable
      expect(c).toContain(
        'queryKey: () => (input === undefined ? ["users.list"] as const : ["users.list", input] as const)',
      );
      expect(c).toContain('queryOptions: () => _queryOptions(');
      expect(c).toContain('infiniteQueryOptions: (overrides?:');
    });

    it('mutation handle exposes mutationOptions', async () => {
      const c = await gen(true);
      expect(c).toContain('mutationOptions: () => _mutationOptions(');
    });

    it('does NOT emit the filterQuery runtime member — that is the nestjs-filter extension', async () => {
      const c = await gen(true);
      // The runtime helper + its value import are gone from core (this fixture has a
      // method-level filter route, so no query-source TypedFilterQuery type either).
      expect(c).not.toContain('filterQuery:');
      expect(c).not.toContain('filterQueryTyped');
      // but filterFields are still discovered + emitted into the ApiRouter types.
      expect(c).toContain('filterFields: "status" | "name"');
    });
  });

  it('empty routes → empty createApi', async () => {
    await emitApi([], outDir, {});
    const c = await readFile(join(outDir, 'api.ts'), 'utf8');
    expect(c).toContain('export function createApi');
  });

  describe('typed errors per route (error field)', () => {
    it('emits error: unknown by default for routes without a declared error type', async () => {
      const c = await gen();
      // Every leaf type block carries an `error` field — `unknown` when undeclared.
      expect(c).toContain('error: unknown;');
    });

    it('emits a declared error type into the leaf and Route.Error resolves it', async () => {
      const errRoutes: RouteDescriptor[] = [
        {
          method: 'POST',
          path: '/api/widgets',
          name: 'widgets.create',
          params: [],
          contract: {
            contractSource: {
              query: null,
              body: '{ name: string }',
              response: 'Widget',
              error: '{ code: string; message: string }',
            },
          },
        },
      ];
      await emitApi(errRoutes, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).toContain('error: { code: string; message: string };');
      // Route.Error<K> resolver is wired to the "error" field.
      expect(c).toContain('export type Error<K extends string> = ResolveByName<K, "error">;');
    });

    it('emits a named errorRef and imports it', async () => {
      const errRoutes: RouteDescriptor[] = [
        {
          method: 'POST',
          path: '/api/widgets',
          name: 'widgets.create',
          params: [],
          contract: {
            contractSource: {
              query: null,
              body: null,
              response: 'Widget',
              error: 'ApiError',
              errorRef: { name: 'ApiError', filePath: '/abs/errors.ts' },
            },
          },
        },
      ];
      await emitApi(errRoutes, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).toContain('error: ApiError;');
      expect(c).toContain('ApiError');
    });
  });

  describe('SSE / streaming routes', () => {
    const streamRoutes: RouteDescriptor[] = [
      {
        method: 'GET',
        path: '/api/events/ticks',
        name: 'events.ticks',
        params: [],
        contract: {
          contractSource: {
            query: null,
            body: null,
            response: '{ count: number }',
            stream: true,
          },
        },
      },
    ];

    it('marks the route stream type in ApiRouter', async () => {
      await emitApi(streamRoutes, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).toContain('stream: true');
      // Default `'json'` serialization wraps the response element type in Jsonify.
      expect(c).toContain('response: Jsonify<{ count: number }>');
    });

    it('exposes an AsyncIterable stream surface on the leaf', async () => {
      await emitApi(streamRoutes, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      // The leaf gains a `stream()` member backed by the fetcher's typed SSE consumer.
      expect(c).toContain('stream: () =>');
      expect(c).toContain('fetcher.sse<');
    });

    it('uses the streamed element type (not the Observable container) for a controllerRef stream route', async () => {
      const cref: RouteDescriptor[] = [
        {
          method: 'GET',
          path: '/api/events/ticks',
          name: 'events.ticks',
          params: [],
          controllerRef: {
            className: 'SseController',
            methodName: 'ticks',
            filePath: '/abs/sse.controller.ts',
          },
          contract: {
            contractSource: {
              query: null,
              body: null,
              // discovery already reduced Observable<MessageEvent<Tick>> → element
              response: '{ count: number }',
              stream: true,
            },
          },
        },
      ];
      await emitApi(cref, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      // The element type is used directly — NOT Awaited<ReturnType<...>> (which would be the Observable).
      // Default `'json'` serialization wraps it in Jsonify.
      expect(c).toContain('response: Jsonify<{ count: number }>');
      expect(c).not.toContain('Awaited<ReturnType<');
    });

    it('emits a Route.Stream<K> type helper', async () => {
      await emitApi(streamRoutes, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).toContain('Stream<K extends string>');
    });

    it('does not add a stream surface to normal routes', async () => {
      await emitApi(routes, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).not.toContain('fetcher.sse<');
      expect(c).not.toContain('stream: () =>');
    });
  });

  describe('response serialization (Jsonify-by-default)', () => {
    it('json mode (default) wraps every response in Jsonify<...> and imports the helper', async () => {
      await emitApi(routes, outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      // Each leaf's response is the JSON wire shape.
      expect(c).toContain('response: Jsonify<User[]>');
      expect(c).toContain('response: Jsonify<User>');
      expect(c).toContain('response: Jsonify<{ data: User[] }>');
      // The helper is imported from the runtime package (same module as Fetcher).
      expect(c).toContain("import type { Jsonify } from '@dudousxd/nestjs-client'");
      // Only the response field is wrapped — never error/body/query.
      expect(c).not.toContain('error: Jsonify<');
      expect(c).not.toContain('body: Jsonify<');
      expect(c).not.toContain('query: Jsonify<');
    });

    it('json mode is the default when serialization is omitted', async () => {
      await emitApi(routes, outDir, { serialization: 'json' });
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).toContain('response: Jsonify<User[]>');
      expect(c).toContain("import type { Jsonify } from '@dudousxd/nestjs-client'");
    });

    it('superjson mode leaves the raw response type and emits no Jsonify import', async () => {
      await emitApi(routes, outDir, { serialization: 'superjson' });
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).toContain('response: User[]');
      expect(c).toContain('response: User');
      expect(c).toContain('response: { data: User[] }');
      expect(c).not.toContain('Jsonify<');
      expect(c).not.toContain('import type { Jsonify }');
    });

    it('tracks fetcherImportPath for the Jsonify import in json mode', async () => {
      await emitApi(routes, outDir, { fetcherImportPath: '~/lib/api' });
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).toContain("import type { Jsonify } from '~/lib/api'");
    });

    it('emits no Jsonify import when there are no contracted routes (json mode)', async () => {
      await emitApi([], outDir, {});
      const c = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(c).not.toContain('import type { Jsonify }');
    });
  });
});
