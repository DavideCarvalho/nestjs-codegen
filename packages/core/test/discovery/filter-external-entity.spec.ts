import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';
import type { FilterFieldType } from '../../src/discovery/types.js';
import { emitApi } from '../../src/emit/emit-api.js';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'app');

describe('@Filterable entity imported from an EXTERNAL package (node_modules .d.ts)', () => {
  it('resolves the external entity and enumerates its columns as filter fields', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'filter-external-entity.controller.ts',
    });
    const route = routes.find((r) => r.name === 'filterExternalEntity.list');
    expect(route).toBeDefined();
    const cs = route!.contract!.contractSource;

    // The route MUST be classified as a (query-source) filter route — not
    // silently degraded to a bodyless route with `filterFields: never`.
    expect(cs.filterSource).toBe('query');
    // Columns enumerated from the package's `.d.ts` declaration.
    expect(cs.filterFields).toEqual(['id', 'name', 'status', 'attempts', 'createdAt']);
    const byName = Object.fromEntries(
      (cs.filterFieldTypes as FilterFieldType[]).map((f) => [f.name, f]),
    );
    expect(byName.id.kind).toBe('number');
    expect(byName.name.kind).toBe('string');
    expect(byName.createdAt.kind).toBe('date');
  });

  it('emits a working filter route (TypedFilterQuery in query position)', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'filter-external-entity.controller.ts',
    });
    const outDir = await mkdtemp(join(tmpdir(), 'filter-external-emit-'));
    try {
      await emitApi(routes, outDir, { extensions: [tanstackQuery()] });
      const content = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(content).toContain(
        'TypedFilterQuery<"id" | "name" | "status" | "attempts" | "createdAt"',
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {});
});
