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
});
