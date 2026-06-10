import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('default (plain fetch)', async () => {
    expect(await gen({})).toMatchSnapshot();
  });

  it('query: true (TanStack handles)', async () => {
    expect(await gen({ query: true })).toMatchSnapshot();
  });

  it('mutationClient: inertia', async () => {
    expect(await gen({ mutationClient: 'inertia' })).toMatchSnapshot();
  });

  it('query + inertia + custom queryImport', async () => {
    expect(
      await gen({ query: true, mutationClient: 'inertia', queryImport: '@tanstack/vue-query' }),
    ).toMatchSnapshot();
  });

  it('empty routes', async () => {
    await emitApi([], outDir, { query: true, mutationClient: 'inertia' });
    expect(await readFile(join(outDir, 'api.ts'), 'utf8')).toMatchSnapshot();
  });
});
