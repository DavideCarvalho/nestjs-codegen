import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    await emitApi(routes, outDir, query === undefined ? {} : { query });
    return readFile(join(outDir, 'api.ts'), 'utf8');
  }

  describe('default (query off): leaves are plain typed fetch functions', () => {
    it('no TanStack import or helpers', async () => {
      const c = await gen();
      expect(c).not.toContain('@tanstack');
      expect(c).not.toContain('_queryOptions');
      expect(c).not.toContain('_mutationOptions');
    });

    it('exposes createApi(fetcher) factory + the Fetcher type import', async () => {
      const c = await gen();
      expect(c).toContain('export function createApi(fetcher: Fetcher)');
      expect(c).toContain("import type { Fetcher } from '@dudousxd/nestjs-client'");
    });

    it('GET leaf is a function that fetches', async () => {
      const c = await gen();
      expect(c).toContain('list: (input?:');
      expect(c).toContain('=> fetcher.get<');
    });

    it('POST leaf is a function that fetches', async () => {
      const c = await gen();
      expect(c).toContain('create: (input?:');
      expect(c).toContain('=> fetcher.post<');
    });

    it('nests by dotted name (api.admin.users.list)', async () => {
      const c = await gen();
      expect(c).toContain('admin: {');
      expect(c).toContain('users: {');
    });
  });

  describe('query: true: leaves return a handle with TanStack helpers', () => {
    it('imports queryOptions/mutationOptions from @tanstack/react-query', async () => {
      const c = await gen(true);
      expect(c).toContain("from '@tanstack/react-query'");
      expect(c).toContain('queryOptions as _queryOptions');
      expect(c).toContain('mutationOptions as _mutationOptions');
    });

    it('GET handle exposes fetch + queryKey + queryOptions', async () => {
      const c = await gen(true);
      expect(c).toContain('list: (input?:');
      expect(c).toContain('fetch: () => fetcher.get<');
      expect(c).toContain('queryKey: () => ["users.list", input] as const');
      expect(c).toContain('queryOptions: () => _queryOptions(');
    });

    it('mutation handle exposes mutationOptions', async () => {
      const c = await gen(true);
      expect(c).toContain('mutationOptions: () => _mutationOptions(');
    });

    it('filter route emits filterQuery + TypedFilter type args', async () => {
      const c = await gen(true);
      expect(c).toContain('filterQuery: () => _filterQueryTyped<');
      expect(c).toContain('"status"');
    });
  });

  it('empty routes → empty createApi', async () => {
    await emitApi([], outDir, {});
    const c = await readFile(join(outDir, 'api.ts'), 'utf8');
    expect(c).toContain('export function createApi');
  });
});
