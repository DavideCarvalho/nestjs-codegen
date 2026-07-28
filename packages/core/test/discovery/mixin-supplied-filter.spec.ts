import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'app');

// ONE discovery for the whole file, over all three fixtures at once. Discovery
// builds a ts-morph Project per call and every assertion below reads the same
// immutable route list, so a call per test is seconds of duplicate work — enough
// to starve the sibling suites vitest runs in parallel.
let discovered: ReturnType<typeof discoverContractsFast> | undefined;
const discover = () => {
  discovered ??= discoverContractsFast({
    cwd: FIXTURES,
    glob: '{mixin-supplied-filter,mixin-options,filter}.controller.ts',
  });
  return discovered;
};

const at = async (path: string) => (await discover()).find((r) => r.path === path);
const fieldsAt = async (path: string) =>
  (await at(path))?.contract?.contractSource.filterFields as string[] | undefined;

describe('a filter supplied to the controller factory', () => {
  it('discovers both routes of the table', async () => {
    const routes = await discover();
    expect(
      routes
        .filter((r) => r.controllerRef?.filePath?.endsWith('mixin-supplied-filter.controller.ts'))
        .map((r) => `${r.method} ${r.path}`)
        .sort(),
    ).toEqual([
      'POST /supplied-filter',
      'POST /supplied-filter/distinct',
      'POST /supplied-override',
      'POST /supplied-override/distinct',
    ]);
  });

  it('describes an inherited route with the SUPPLIED filter, not the generated fallback', async () => {
    // `assignedTo` exists on no entity — it can only have come from the
    // hand-written filter's `@FilterFor`. `title`/`secret` are the call-site
    // entity's columns, i.e. exactly what the generated fallback would emit.
    expect(await fieldsAt('/supplied-filter')).toEqual(['id', 'auditedBy', 'assignedTo']);
    expect((await at('/supplied-filter'))?.contract?.contractSource.filterSource).toBe('body');
  });

  it('respects the supplied filter’s `allowed` narrowing', async () => {
    const fields = await fieldsAt('/supplied-filter');
    // `internalNote` is a real column of the filter's entity that the allowlist
    // excludes. Emitting it types a call the server rejects at runtime — the
    // damaging direction, since it type-checks at the call site.
    expect(fields).not.toContain('internalNote');
    // ...and the call-site entity's own columns are not smuggled in either.
    expect(fields).not.toContain('title');
    expect(fields).not.toContain('secret');
  });

  it('types the `@FilterFor` virtual from its declared hint', async () => {
    const types = (await at('/supplied-filter'))?.contract?.contractSource.filterFieldTypes as
      | Array<{ name: string; kind: string }>
      | undefined;
    expect(types?.find((f) => f.name === 'assignedTo')?.kind).toBe('string');
  });

  it('lets the supplied filter’s OWN entity win over the call-site entity', async () => {
    // The factory is called with `entity: WorkOrder`; the filter declares
    // `@Filterable({ entity: WorkOrderView })`. `auditedBy` exists only on the
    // latter. The call-site entity is a REPAIR for a generated filter (whose
    // `entity` names the factory's parameter) — a hand-written filter names a
    // real class, and that is the class the runtime queries.
    expect(await fieldsAt('/supplied-filter')).toContain('auditedBy');
  });

  it('applies the supplied filter to every route of the table, not just one', async () => {
    // The routes of one table must not disagree about what is filterable.
    expect(await fieldsAt('/supplied-filter/distinct')).toEqual(['id', 'auditedBy', 'assignedTo']);
    expect(await fieldsAt('/supplied-override/distinct')).toEqual([
      'id',
      'auditedBy',
      'assignedTo',
    ]);
  });

  it('lets an override that names its own filter BY IDENTIFIER win', async () => {
    // The only per-route statement about the filter that can be written, so the
    // most specific: it beats the factory's `filter` option for this route.
    expect(await fieldsAt('/supplied-override')).toEqual(['id', 'internalNote']);
    expect((await at('/supplied-override'))?.contract?.contractSource.filterSource).toBe('body');
  });
});

describe('precedence guards', () => {
  it('keeps `@ApplyFilter(<Const>.filter)` below the factory’s filter option', async () => {
    // `mixin-options.controller.ts` overrides with `OptWidgetTable.filter` while
    // its factory call also passes `filter: CustomWidgetFilter`. That expression
    // forwards the factory's product rather than naming a filter of its own, so
    // it must not outrank the option — but `CustomWidgetFilter` is opaque to
    // static reading (no properties, no `@Filterable`), and an unreadable
    // preferred source must degrade to the fallback rather than to `never`.
    expect(await fieldsAt('/opt-overridden/search')).toEqual(['id', 'name']);
  });

  it('leaves a plain @ApplyFilter route (no factory at all) alone', async () => {
    expect(await fieldsAt('/api/users')).toEqual(['name', 'minAge', 'status']);
  });
});
