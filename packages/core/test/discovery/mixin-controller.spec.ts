import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'app');

describe('mixin controller discovery', () => {
  it('discovers routes inherited from a factory-produced base class', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'mixin.controller.ts',
    });
    const paths = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(paths).toEqual([
      'POST /gadgets/search',
      'POST /gadgets/search/distinct',
      'POST /widgets/search',
      'POST /widgets/search/distinct',
    ]);
  });

  it('records the factory and the call-site entity argument on the route', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'mixin.controller.ts',
    });
    const rows = routes.find((r) => r.path === '/widgets/search');
    // controllerRef keeps pointing at the DERIVED class (the call site), while
    // methodName names a method that exists only on the factory-produced base.
    expect(rows?.controllerRef?.className).toBe('SearchWidgetsController');
    expect(rows?.controllerRef?.mixin?.factoryName).toBe('createTableController');
    expect(rows?.controllerRef?.mixin?.classArgs[0]?.name).toBe('Widget');
    expect(rows?.controllerRef?.mixin?.classArgs[0]?.filePath).toMatch(/table-factory\.ts$/);
  });

  it('leaves non-mixin routes without a mixin binding', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'filter.controller.ts',
    });
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((r) => r.controllerRef?.mixin === undefined)).toBe(true);
  });

  it('instantiates the generic response type against the derived class', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'mixin.controller.ts',
    });
    // Pinned to the EXACT text, not toContain(), so a regression in the type
    // argument can't hide inside a partial match.
    //
    // KNOWN GAP: the text carries an `import("./table-factory")` specifier,
    // relative to the controller file — the emitted api.ts lives in outDir, so
    // this is not yet emit-ready. Routing it through type-ref-resolution.ts (to
    // produce a real named import) is a follow-up; pinning the current text here
    // makes that change visible rather than silent.
    const mapped = routes.find((r) => r.path === '/widgets/search');
    expect(mapped?.contract?.contractSource.response).toBe(
      'import("./table-factory").Paginated<WidgetDto>',
    );
    // no `dto` → D falls back to its default, E = Widget
    const raw = routes.find((r) => r.path === '/gadgets/search');
    expect(raw?.contract?.contractSource.response).toBe(
      'import("./table-factory").Paginated<Widget>',
    );
    // the distinct route is not generic at all
    const distinct = routes.find((r) => r.path === '/widgets/search/distinct');
    expect(distinct?.contract?.contractSource.response).toBe(
      'import("./table-factory").Paginated<Record<string, unknown>>',
    );
  });

  it('derives filterFields from the mixin entity argument', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'mixin.controller.ts',
    });
    // @ApplyFilter points at a filter generated inside the factory, whose
    // @Filterable({ entity }) names the factory's PARAMETER — the entity is only
    // knowable from the call site's mixin binding.
    const rows = routes.find((r) => r.path === '/widgets/search');
    expect(rows?.contract?.contractSource.filterFields).toEqual(['id', 'name']);
    expect(rows?.contract?.contractSource.filterSource).toBe('body');

    const distinct = routes.find((r) => r.path === '/widgets/search/distinct');
    expect(distinct?.contract?.contractSource.filterFields).toEqual(['id', 'name']);
  });
});

describe('mixin controller with an overridden route', () => {
  it('follows an identifier heritage clause to the factory call', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'mixin-override.controller.ts',
    });
    const paths = routes.map((r) => r.path).sort();
    // `distinct` is inherited and must survive; `search` is overridden.
    expect(paths).toEqual(['/overridden/search', '/overridden/search/distinct']);
  });

  it('keeps the derived class own method, not the inherited one', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'mixin-override.controller.ts',
    });
    const search = routes.filter((r) => r.path === '/overridden/search');
    // Exactly one route — emitting both would trip the name-collision check.
    expect(search).toHaveLength(1);
    expect(search[0]?.controllerRef?.className).toBe('SearchOverriddenController');
  });

  it('resolves @ApplyFilter(<Table>.filter) through the factory static', async () => {
    const routes = await discoverContractsFast({
      cwd: FIXTURES,
      glob: 'mixin-override.controller.ts',
    });
    // The override can only name the generated filter as a property access on
    // the factory result. Skipping it is not a partial result — the route emits
    // `body: never` / `filterFields: never`, silently dropping the typed filter
    // builder from exactly the routes that took the escape hatch.
    const search = routes.find((r) => r.path === '/overridden/search');
    expect(search?.contract?.contractSource.filterFields).toEqual(['id', 'name']);
    expect(search?.contract?.contractSource.filterSource).toBe('body');

    // The inherited sibling keeps working, so the two routes of one table can't
    // disagree about what is filterable.
    const distinct = routes.find((r) => r.path === '/overridden/search/distinct');
    expect(distinct?.contract?.contractSource.filterFields).toEqual(['id', 'name']);
  });
});

describe('mixin controller called with a single options object', () => {
  const discover = (glob: string) => discoverContractsFast({ cwd: FIXTURES, glob });

  it('discovers routes from a factory called with one options object', async () => {
    const routes = await discover('mixin-options.controller.ts');
    const paths = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(paths).toEqual([
      'POST /opt-overridden/search',
      'POST /opt-overridden/search/distinct',
      'POST /opt-widgets/search',
      'POST /opt-widgets/search/distinct',
    ]);
  });

  it('records class-valued options properties by NAME on the mixin binding', async () => {
    const routes = await discover('mixin-options.controller.ts');
    const rows = routes.find((r) => r.path === '/opt-widgets/search');
    expect(rows?.controllerRef?.mixin?.factoryName).toBe('createTableController');
    expect(rows?.controllerRef?.mixin?.namedClassArgs.entity?.name).toBe('Widget');
    expect(rows?.controllerRef?.mixin?.namedClassArgs.entity?.filePath).toMatch(
      /table-factory\.ts$/,
    );
    // No positional class argument exists in this call form at all — which is
    // exactly why reading `classArgs[0]` as "the entity" silently emptied the
    // route rather than degrading it.
    expect(rows?.controllerRef?.mixin?.classArgs).toEqual([]);
  });

  it('records a second class-valued property (`filter`) for downstream consumers', async () => {
    const routes = await discover('mixin-options.controller.ts');
    // Read by `@dudousxd/nestjs-filter-codegen`, not by this package — the reason
    // the properties are keyed by name instead of `entity` being special-cased.
    const override = routes.find((r) => r.path === '/opt-overridden/search');
    expect(override?.controllerRef?.mixin?.namedClassArgs.filter?.name).toBe('CustomWidgetFilter');
    expect(override?.controllerRef?.mixin?.namedClassArgs.filter?.filePath).toMatch(
      /table-options-factory\.ts$/,
    );
    expect(override?.controllerRef?.mixin?.namedClassArgs.entity?.name).toBe('Widget');
  });

  it('derives the SAME contract as the positional call form', async () => {
    const [positional, optionsObject] = await Promise.all([
      discover('mixin.controller.ts'),
      discover('mixin-options.controller.ts'),
    ]);
    // Equality, not a spot-check: the two call forms are the same factory
    // parameterised the same way, so any divergence in body / filterFields /
    // response is a bug in one of the two paths.
    expect(optionsObject.find((r) => r.path === '/opt-widgets/search')?.contract).toEqual(
      positional.find((r) => r.path === '/widgets/search')?.contract,
    );
    expect(optionsObject.find((r) => r.path === '/opt-widgets/search/distinct')?.contract).toEqual(
      positional.find((r) => r.path === '/widgets/search/distinct')?.contract,
    );
  });

  it('keeps the typed filter builder on inherited AND overridden routes', async () => {
    const routes = await discover('mixin-options.controller.ts');
    // Pinned explicitly as well as by the equality above: `never` here is the
    // whole user-visible symptom, and it must fail loudly if it comes back.
    const inherited = routes.find((r) => r.path === '/opt-widgets/search');
    expect(inherited?.contract?.contractSource.filterFields).toEqual(['id', 'name']);
    expect(inherited?.contract?.contractSource.filterSource).toBe('body');

    const override = routes.find((r) => r.path === '/opt-overridden/search');
    expect(override?.contract?.contractSource.filterFields).toEqual(['id', 'name']);
    expect(override?.contract?.contractSource.filterSource).toBe('body');

    const inheritedSibling = routes.find((r) => r.path === '/opt-overridden/search/distinct');
    expect(inheritedSibling?.contract?.contractSource.filterFields).toEqual(['id', 'name']);
  });

  it('matches the positional overridden route contract', async () => {
    const [positional, optionsObject] = await Promise.all([
      discover('mixin-override.controller.ts'),
      discover('mixin-options.controller.ts'),
    ]);
    expect(
      optionsObject.find((r) => r.path === '/opt-overridden/search')?.contract?.contractSource
        .filterFieldTypes,
    ).toEqual(
      positional.find((r) => r.path === '/overridden/search')?.contract?.contractSource
        .filterFieldTypes,
    );
  });
});
