/**
 * Discovery of a factory-produced base class's OWN heritage chain.
 *
 * A factory that wraps another factory is how a controller opts into an extra
 * route without every controller extending the shared factory inheriting it —
 * the conditionality is which factory you extend, and the extra route stays an
 * ordinary decorated method. Nest mounts the whole prototype chain at runtime;
 * discovery has to walk the same chain, or a controller reaches the client with
 * only the outermost factory's routes and no error anywhere.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'app');

function discover() {
  return discoverContractsFast({ cwd: FIXTURES, glob: 'two-level.controller.ts' });
}

describe('factory-produced base with its own heritage', () => {
  it('discovers routes from every level of the chain', async () => {
    const routes = await discover();
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      // GeneratedExportable (level 2) → GeneratedTableBase (level 1) → TableHealthController
      'GET /gadgets/health',
      'GET /widgets/health',
      'POST /gadgets',
      'POST /widgets',
      'POST /widgets/export',
    ]);
  });

  it('gives the extra route ONLY to the controller that extends the wrapping factory', async () => {
    const routes = await discover();
    const namesOf = (className: string) =>
      routes
        .filter((r) => r.controllerRef?.className === className)
        .map((r) => r.name)
        .sort();
    // The whole point of the two-factory shape: `export` is declared once, and
    // the controller extending the inner factory must not inherit it — while
    // both controllers still get every route the inner factory declares.
    expect(namesOf('WidgetsController')).toEqual([
      'widgets.export',
      'widgets.health',
      'widgets.search',
    ]);
    expect(namesOf('GadgetsController')).toEqual(['gadgets.health', 'gadgets.search']);
  });

  it('reaches a plain class base through a factory-produced class', async () => {
    const routes = await discover();
    // `TableHealthController` is an ordinary exported class, not a factory
    // product — the level-1 factory's class extends it directly.
    const health = routes.find((r) => r.path === '/widgets/health');
    expect(health?.method).toBe('GET');
    expect(health?.name).toBe('widgets.health');
    // Carries the `import("./two-level-factory")` specifier every inherited
    // route's response does — see the KNOWN GAP in mixin-controller.spec.ts.
    expect(health?.contract?.contractSource.response).toBe(
      'import("./two-level-factory").TableHealthDto',
    );
  });

  it('instantiates the inner factory response type against the derived controller', async () => {
    const routes = await discover();
    // `Promise<Paginated<E>>` is annotated two factories away; E binds only at
    // the controller's call site.
    for (const path of ['/widgets', '/gadgets']) {
      expect(routes.find((r) => r.path === path)?.contract?.contractSource.response).toBe(
        'import("./table-factory").Paginated<Widget>',
      );
    }
  });

  it('resolves the inner factory generated filter through both levels', async () => {
    const routes = await discover();
    // The generated filter's `@Filterable({ entity })` names the INNER factory's
    // parameter, which the outer factory forwards — so the entity is only
    // knowable from the controller's call-site argument.
    const search = routes.find((r) => r.path === '/widgets');
    expect(search?.contract?.contractSource.filterFields).toEqual(['id', 'name']);
    expect(search?.contract?.contractSource.filterSource).toBe('body');
  });

  it('records the OUTER factory as the mixin binding for an inherited route', async () => {
    const routes = await discover();
    const search = routes.find((r) => r.path === '/widgets');
    expect(search?.controllerRef?.className).toBe('WidgetsController');
    expect(search?.controllerRef?.mixin?.factoryName).toBe('createExportableTableController');
    expect(search?.controllerRef?.mixin?.namedClassArgs.entity?.name).toBe('Widget');
  });
});

describe('types of a route inherited from a factory', () => {
  it('resolves a @Body() DTO declared in the factory file, not the controller file', async () => {
    const routes = await discover();
    const exportRoute = routes.find((r) => r.path === '/widgets/export');
    // The DTO is imported by the FACTORY; the controller file never names it.
    // Resolving against the controller yielded `unknown` — a route that reached
    // the client accepting anything.
    expect(exportRoute?.contract?.contractSource.body).toBe('{ columns: Array<string> }');
    expect(exportRoute?.contract?.contractSource.bodyRef?.name).toBe('ExportRequestDto');
    expect(exportRoute?.contract?.contractSource.bodyRef?.filePath).toMatch(
      /two-level-factory\.ts$/,
    );
  });

  it('points the response ref at the file that declares the DTO', async () => {
    const routes = await discover();
    const exportRoute = routes.find((r) => r.path === '/widgets/export');
    expect(exportRoute?.contract?.contractSource.responseRef?.name).toBe('ExportResultDto');
    expect(exportRoute?.contract?.contractSource.responseRef?.filePath).toMatch(
      /two-level-factory\.ts$/,
    );
  });
});
