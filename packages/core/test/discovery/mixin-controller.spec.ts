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
});
