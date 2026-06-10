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
      expect(c).toContain('queryKey: () => ["users.list", input] as const');
      expect(c).toContain('queryOptions: () => _queryOptions(');
      expect(c).toContain('infiniteQueryOptions: () => _infiniteQueryOptions(');
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
});
