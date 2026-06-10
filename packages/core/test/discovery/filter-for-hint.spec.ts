import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';
import type { FilterFieldType } from '../../src/discovery/types.js';
import { emitApi } from '../../src/emit/emit-api.js';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'app');

async function discoverWidget() {
  const routes = await discoverContractsFast({
    cwd: FIXTURES,
    glob: 'filter-for-hint.controller.ts',
  });
  const route = routes.find((r) => r.name === 'filterForHint.list');
  expect(route).toBeDefined();
  return route!.contract!.contractSource;
}

describe('@FilterFor type hint discovery', () => {
  it('upgrades virtual @FilterFor fields from their { type } hint', async () => {
    const cs = await discoverWidget();
    const fts = cs.filterFieldTypes as FilterFieldType[];
    const byName = Object.fromEntries(fts.map((f) => [f.name, f]));

    // Real class property is still classified normally.
    expect(byName.name.kind).toBe('string');

    // Virtual numeric field upgraded via { type: 'number' }.
    expect(byName.minAge.kind).toBe('number');

    // Virtual enum field → string union from the string[] hint.
    expect(byName.state.kind).toBe('string');
    expect(byName.state.enumValues).toEqual(['active', 'archived']);

    // Virtual field without a hint is not discoverable (no property / column /
    // hint) — it simply doesn't appear, matching prior behavior.
    expect(byName.legacy).toBeUndefined();
  });

  it('adds hinted virtual keys to the Fields name union', async () => {
    const cs = await discoverWidget();
    expect(cs.filterFields).toContain('minAge');
    expect(cs.filterFields).toContain('state');
    // An unhinted @FilterFor key never becomes a field.
    expect(cs.filterFields).not.toContain('legacy');
    // filterFields stays in sync with filterFieldTypes names.
    const fts = cs.filterFieldTypes as FilterFieldType[];
    expect(cs.filterFields).toEqual(fts.map((f) => f.name));
  });

  it('an explicit @FilterFor hint wins over a same-named class property', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'filter-for-hint.controller.ts',
    });
    const route = routes.find((r) => r.name === 'filterForHint.overrides');
    expect(route).toBeDefined();
    const fts = route!.contract!.contractSource.filterFieldTypes as FilterFieldType[];
    const score = fts.find((f) => f.name === 'score');
    // The string property is overridden by the { type: 'number' } hint.
    expect(score?.kind).toBe('number');
    // Field must appear exactly once (no duplicate from property + hint).
    expect(fts.filter((f) => f.name === 'score')).toHaveLength(1);
  });
});

describe('@FilterFor type hint emit', () => {
  let outDir: string;
  afterEach(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it('discovers virtual field types (the type map @dudousxd/nestjs-filter-codegen renders)', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'filter-for-hint.controller.ts',
    });
    const cs = routes.find((r) => r.contract?.contractSource.filterFields?.length)?.contract
      ?.contractSource;
    const fts = cs?.filterFieldTypes as FilterFieldType[];
    const byName = Object.fromEntries(fts.map((f) => [f.name, f]));
    // The virtual fields carry their upgraded types (number, enum union).
    expect(byName.minAge.kind).toBe('number');
    expect(byName.state.enumValues).toEqual(['active', 'archived']);
    expect(byName.name.kind).toBe('string');
  });
});
