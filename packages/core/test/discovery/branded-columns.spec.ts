import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';
import type { FilterFieldType } from '../../src/discovery/types.js';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'app');

async function classifyBrandedColumns() {
  const routes = await discoverContractsFast({
    cwd: FIXTURES,
    glob: 'branded-columns.controller.ts',
  });
  const route = routes.find((r) => r.name === 'branded.list');
  expect(route).toBeDefined();
  const fts = route?.contract?.contractSource.filterFieldTypes as FilterFieldType[];
  return Object.fromEntries(fts.map((f) => [f.name, f]));
}

/**
 * A MikroORM entity writes nearly every nullable column as `Opt<T>`. Before
 * these, all of them classified `unknown` — and `unknown` is indistinguishable
 * from "the classifier could not tell", so every consumer that reads a kind had
 * to fall back to permissive for an entity that had in fact declared its types
 * perfectly well.
 */
describe('transparent type brands', () => {
  it('classifies a bare primitive, as it always did', async () => {
    const byName = await classifyBrandedColumns();
    expect(byName.plainName?.kind).toBe('string');
    expect(byName.plainCount?.kind).toBe('number');
  });

  it('sees through Opt<T> to the real type', async () => {
    const byName = await classifyBrandedColumns();
    expect(byName.brandedName?.kind).toBe('string');
    expect(byName.brandedCount?.kind).toBe('number');
    expect(byName.brandedFlag?.kind).toBe('boolean');
    expect(byName.brandedDate?.kind).toBe('date');
  });

  it('sees through Hidden<T>, and through a nesting of both', async () => {
    const byName = await classifyBrandedColumns();
    expect(byName.hiddenSecret?.kind).toBe('string');
    // Recursion, not a single unwrap: `Opt<Hidden<number>>` is a number.
    expect(byName.doubleBranded?.kind).toBe('number');
  });

  it('does NOT unwrap a relation wrapper', async () => {
    const byName = await classifyBrandedColumns();
    // The guard on the allowlist. `Ref<Owner>` holds a reference object, not an
    // `Owner`, so unwrapping it would classify a relation as whatever its
    // target's shape happens to be — silently, and only visibly downstream.
    expect(byName.owner?.kind).not.toBe('string');
  });
});
