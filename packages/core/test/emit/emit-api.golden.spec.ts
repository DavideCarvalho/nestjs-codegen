import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import { emitApi } from '../../src/emit/emit-api.js';

/**
 * GOLDEN GATE for the LeafModel refactor (extension-system Phase 1).
 *
 * Snapshots the FULL `api.ts` output for a representative route set across all four
 * shapes (default fetch, TanStack handles, Inertia mode, filter + query). The refactor
 * of `emit-api.ts` to a transport/layer/member pipeline MUST keep these byte-identical.
 * If a snapshot changes, the refactor altered behavior — stop and reconcile.
 */
const routes: RouteDescriptor[] = [
  {
    method: 'GET',
    path: '/api/users',
    name: 'users.list',
    params: [],
    contract: { contractSource: { query: '{ active?: boolean }', body: null, response: 'User[]' } },
  },
  {
    method: 'GET',
    path: '/api/users/:id',
    name: 'users.show',
    params: [{ name: 'id', source: 'path' }],
    contract: { contractSource: { query: null, body: null, response: 'User' } },
  },
  {
    method: 'POST',
    path: '/api/users',
    name: 'users.create',
    params: [],
    contract: { contractSource: { query: null, body: '{ name: string }', response: 'User' } },
  },
  {
    method: 'PATCH',
    path: '/api/users/:id',
    name: 'users.update',
    params: [{ name: 'id', source: 'path' }],
    contract: { contractSource: { query: null, body: '{ name?: string }', response: 'User' } },
  },
  {
    method: 'GET',
    path: '/api/admin/reports',
    name: 'admin.reports.list',
    params: [],
    contract: { contractSource: { query: null, body: null, response: 'Report[]' } },
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
        response: '{ data: Run[] }',
        filterFields: ['status', 'name'],
      },
    },
  },
  {
    method: 'GET',
    path: '/api/orders',
    name: 'orders.list',
    params: [],
    contract: {
      contractSource: {
        query: null,
        body: null,
        response: 'Order[]',
        filterSource: 'query',
        filterFields: ['total', 'state'],
      },
    },
  },
  // Binary (blob) response, GET — `fetcher.fetchBlob` defaults to GET, no
  // explicit `method` opt needed.
  {
    method: 'GET',
    path: '/api/files/:id/download',
    name: 'files.download',
    params: [{ name: 'id', source: 'path' }],
    contract: {
      contractSource: { query: null, body: null, response: 'unknown', binaryResponse: true },
    },
  },
  // Binary (blob) response, POST — proves `fetchBlob` is issued with an
  // explicit `method: 'POST'` opt (fetchBlob defaults to GET).
  {
    method: 'POST',
    path: '/api/reports/export',
    name: 'reports.export',
    params: [],
    contract: {
      contractSource: {
        query: null,
        body: '{ format: string }',
        response: 'unknown',
        binaryResponse: true,
      },
    },
  },
  // `@AsQuery()`-marked POST: a non-GET route whose semantics are a read, so
  // it gets `queryOptions` (and still `mutationOptions`, per the non-GET rule).
  {
    method: 'POST',
    path: '/api/reports/search',
    name: 'reports.search',
    params: [],
    contract: {
      contractSource: {
        query: null,
        body: '{ term: string }',
        response: '{ data: Report[] }',
        asQuery: true,
      },
    },
  },
];

describe('emitApi golden output', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'codegen-emit-api-golden-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  async function gen(opts: Parameters<typeof emitApi>[2]): Promise<string> {
    await emitApi(routes, outDir, opts);
    return readFile(join(outDir, 'api.ts'), 'utf8');
  }

  /**
   * Slice out one leaf's IMPLEMENTATION block (inside `createApi`), from
   * `<key>: (input?: ...) => ({` up to its own closing `}),` (matched by
   * indentation, NOT the first `}),` — every TanStack member line like
   * `queryOptions: () => _queryOptions({ ... }),` also ends in `}),`, just at
   * one indent level deeper). `after` scopes the search past a preceding
   * unique marker so it never matches an unrelated same-named leaf (e.g.
   * `reports.search` vs `pipelineRuns.search`, both keyed `search`).
   */
  function leafBlock(source: string, key: string, after: string): string {
    const scopeStart = source.indexOf(after);
    const leafStart = source.indexOf(`${key}: (input?:`, scopeStart);
    const lineStart = source.lastIndexOf('\n', leafStart) + 1;
    const indent = source.slice(lineStart, leafStart);
    const leafEnd = source.indexOf(`\n${indent}}),`, leafStart);
    return source.slice(leafStart, leafEnd);
  }

  it('default (plain fetch)', async () => {
    const c = await gen({});
    expect(c).toMatchSnapshot();
    // handleQuery is a TanStack-layer contribution — absent with no client layer.
    expect(c).not.toContain('handleQuery');
  });

  it('query: true (TanStack handles)', async () => {
    const c = await gen({ extensions: [tanstackQuery()] });
    expect(c).toMatchSnapshot();
    // Feature 4: handleQuery is emitted once, verbatim, when the TanStack layer is active.
    expect(c).toContain('export function handleQuery<TData>(handle: {');
  });

  it('tanstack with a custom queryImport', async () => {
    expect(
      await gen({ extensions: [tanstackQuery({ import: '@tanstack/vue-query' })] }),
    ).toMatchSnapshot();
  });

  describe('binary (blob) responses', () => {
    it('emits RawResponse<Blob> (never Jsonify) and fetches via fetcher.fetchBlob', async () => {
      const c = await gen({});
      expect(c).toContain("import type { RawResponse } from '@dudousxd/nestjs-client';");
      expect(c).toContain(
        'download: { method: "GET"; url: "/api/files/:id/download"; params: { id: string }; query: never; body: never; response: RawResponse<Blob>;',
      );
      expect(c).not.toContain('response: Jsonify<RawResponse<Blob>>');
      // GET binary: fetchBlob defaults to GET, no explicit `method` opt needed.
      expect(c).toContain(
        'fetcher.fetchBlob(route("files.download" as never, input?.params as never) || "/api/files/:id/download", { query: input?.query as Record<string, unknown> | undefined })',
      );
    });

    it('a non-GET binary route passes an explicit method to fetchBlob', async () => {
      const c = await gen({});
      expect(c).toContain(
        'fetcher.fetchBlob(route("reports.export" as never) || "/api/reports/export", { method: "POST", body: input?.body })',
      );
    });

    it('binary routes are flagged binary: true on ApiRouter (and false elsewhere)', async () => {
      const c = await gen({});
      expect(c).toContain('binary: true');
      expect(c).toContain('binary: false');
    });

    it('TanStack: binary GET gets queryOptions but NOT infiniteQueryOptions', async () => {
      const c = await gen({ extensions: [tanstackQuery()] });
      const leaf = leafBlock(c, 'download', 'export function createApi');
      expect(leaf).toContain('queryOptions:');
      expect(leaf).not.toContain('infiniteQueryOptions:');
    });

    it('TanStack: binary POST gets mutationOptions like any other non-GET route', async () => {
      const c = await gen({ extensions: [tanstackQuery()] });
      const leaf = leafBlock(c, 'export', 'export function createApi');
      expect(leaf).toContain('mutationOptions:');
      expect(leaf).not.toContain('queryOptions:');
    });
  });

  describe('@AsQuery() POST routes', () => {
    it('TanStack: an @AsQuery() POST gets BOTH queryOptions and mutationOptions', async () => {
      const c = await gen({ extensions: [tanstackQuery()] });
      // Scope past `reports.export`'s leaf (which precedes `reports.search` in the
      // emitted body) — a bare 'search:' would otherwise match `pipelineRuns.search` first.
      const leaf = leafBlock(c, 'search', 'export: (input?:');
      expect(leaf).toContain('queryOptions:');
      expect(leaf).toContain('mutationOptions:');
    });

    it('issues via fetcher.post — asQuery only affects request-shape flags, not the HTTP verb', async () => {
      const c = await gen({});
      expect(c).toContain(
        'fetcher.post<ApiRouter["reports"]["search"][\'response\']>(route("reports.search" as never) || "/api/reports/search", { body: input?.body })',
      );
    });
  });

  it('empty routes', async () => {
    await emitApi([], outDir, { extensions: [tanstackQuery()] });
    expect(await readFile(join(outDir, 'api.ts'), 'utf8')).toMatchSnapshot();
  });
});
