import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';
import type { FilterFieldType } from '../../src/discovery/types.js';
import { emitApi } from '../../src/emit/emit-api.js';

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

/**
 * Unwrapping the brand made the TS-derived kind sharper, and on a MikroORM
 * entity the TS type is only one of the two things declared about a column.
 * `@Property({ columnType: 'date', type: DateType }) x?: Opt<string>` says
 * BOTH "date column" and "string value" — a DATE read back as 'YYYY-MM-DD' —
 * and answering `string` there is what dropped these fields out of the
 * operator-gated unions the client derives from the kind (`OrderableFieldsOf`,
 * `ExtentFieldsOf`): `.lt('serviceEndDate', …)` stopped compiling on a column
 * that had been filterable all along.
 */
describe('a branded column whose ORM type disagrees with its TS type', () => {
  it('is still discovered and emitted', async () => {
    const byName = await classifyBrandedColumns();
    expect(Object.keys(byName)).toContain('serviceEndDate');
    expect(Object.keys(byName)).toContain('nextMaintenanceDate');
  });

  it('classifies unknown rather than picking a side', async () => {
    const byName = await classifyBrandedColumns();
    // Neither answer is usable on its own: `string` refuses the ordering and
    // extent operators a DATE column supports, and `date` types the value as a
    // `Date` the column never holds. A disagreement is not knowledge — and
    // `unknown` is the one kind that stays permissive in both directions.
    expect(byName.serviceEndDate?.kind).toBe('unknown');
    expect(byName.nextMaintenanceDate?.kind).toBe('unknown');
    // The same shape with the other classic mapped column: DECIMAL as a string.
    expect(byName.totalCost?.kind).toBe('unknown');
    expect(byName.serviceEndDate?.nullable).toBe(true);
  });

  it('keeps the sharper kind when the two agree', async () => {
    const byName = await classifyBrandedColumns();
    // The 0.23.0 improvement, untouched: the column type corroborates the TS
    // type, so the brand still resolves to its argument.
    expect(byName.interval?.kind).toBe('number');
    expect(byName.assetName?.kind).toBe('string');
    // …as does a branded column that declares no column type at all.
    expect(byName.brandedName?.kind).toBe('string');
  });

  it('emits the field into the route type map', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'branded-columns.controller.ts',
    });
    const outDir = join(tmpdir(), `codegen-branded-${Date.now()}`);
    try {
      await emitApi(routes, outDir);
      const content = await readFile(join(outDir, 'api.ts'), 'utf8');
      expect(content).toContain('"serviceEndDate": unknown | null');
      expect(content).toContain('"interval": number | null');
      expect(content).toContain('"serviceEndDate"');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
