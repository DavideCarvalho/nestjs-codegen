import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'app');
const discover = (glob: string) => discoverContractsFast({ cwd: FIXTURES, glob });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mixin controller reached through a property-access callee', () => {
  it('discovers routes for every resolvable callee shape', async () => {
    const routes = [
      ...(await discover('mixin-callee-shapes.controller.ts')),
      ...(await discover('mixin-namespace.controller.ts')),
    ];
    const paths = routes.map((r) => `${r.method} ${r.path}`).sort();
    // A missed callee shape does not degrade the controller, it deletes it —
    // so this asserts the full set, not that some routes exist.
    expect(paths).toEqual([
      'POST /namespaced/search',
      'POST /namespaced/search/distinct',
      'POST /reexported/search',
      'POST /reexported/search/distinct',
      'POST /shorthand/search',
      'POST /shorthand/search/distinct',
      'POST /static/search',
    ]);
  });

  it('binds the mixin to the factory DECLARATION, not the callee text', async () => {
    const routes = [
      ...(await discover('mixin-callee-shapes.controller.ts')),
      ...(await discover('mixin-namespace.controller.ts')),
    ];
    // `factoryName` is looked up by name inside `factoryFilePath` downstream, so
    // a qualified `tables.createTableController` would resolve to nothing.
    const namespaced = routes.find((r) => r.path === '/namespaced/search');
    expect(namespaced?.controllerRef?.mixin?.factoryName).toBe('createTableController');
    expect(namespaced?.controllerRef?.mixin?.factoryFilePath).toMatch(/table-factory\.ts$/);

    const reexported = routes.find((r) => r.path === '/reexported/search');
    expect(reexported?.controllerRef?.mixin?.factoryName).toBe('createTableController');
    expect(reexported?.controllerRef?.mixin?.factoryFilePath).toMatch(/table-factory\.ts$/);

    const shorthand = routes.find((r) => r.path === '/shorthand/search');
    expect(shorthand?.controllerRef?.mixin?.factoryName).toBe('createTableController');

    // A static method resolves to its own declaring file, and is named by the
    // method rather than by the class holding it.
    const staticMethod = routes.find((r) => r.path === '/static/search');
    expect(staticMethod?.controllerRef?.mixin?.factoryName).toBe('create');
    expect(staticMethod?.controllerRef?.mixin?.factoryFilePath).toMatch(/table-callee-shapes\.ts$/);
  });

  it('carries the call-site entity argument through every shape', async () => {
    const routes = [
      ...(await discover('mixin-callee-shapes.controller.ts')),
      ...(await discover('mixin-namespace.controller.ts')),
    ];
    for (const path of [
      '/namespaced/search',
      '/static/search',
      '/reexported/search',
      '/shorthand/search',
    ]) {
      const route = routes.find((r) => r.path === path);
      expect(route?.controllerRef?.mixin?.classArgs[0]?.name, path).toBe('Widget');
      // The generated filter names the factory's own PARAMETER, so filter fields
      // only exist if the call-site entity survived the new resolution path.
      expect(route?.contract?.contractSource.filterFields, path).toEqual(['id', 'name']);
      expect(route?.contract?.contractSource.filterSource, path).toBe('body');
    }
  });

  it('derives the SAME contract as the bare-identifier callee', async () => {
    const [shapes, plain] = await Promise.all([
      discover('mixin-callee-shapes.controller.ts'),
      discover('mixin.controller.ts'),
    ]);
    // The factory and its arguments are identical; only the way the call site
    // names the function differs, so the contract must be byte-identical.
    const reference = plain.find((r) => r.path === '/gadgets/search')?.contract;
    expect(reference).toBeDefined();
    expect(shapes.find((r) => r.path === '/reexported/search')?.contract).toEqual(reference);
    expect(shapes.find((r) => r.path === '/shorthand/search')?.contract).toEqual(reference);
  });

  it('prints the namespaced response type through the namespace alias', async () => {
    const routes = await discover('mixin-namespace.controller.ts');
    // Pinned rather than compared: the checker prints a type as the CALL SITE can
    // name it, so a controller that imported the factory's module as `tables`
    // gets `tables.Paginated<...>` where a named import gets the
    // `import("./table-factory")` form. Both share the pre-existing gap that the
    // text is relative to the controller file rather than to outDir (see
    // mixin-controller.spec.ts); pinning it keeps the follow-up visible instead
    // of letting the namespace form drift silently.
    expect(
      routes.find((r) => r.path === '/namespaced/search')?.contract?.contractSource.response,
    ).toBe('tables.Paginated<Widget>');
  });

  it('stays silent on the shapes it resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await discover('mixin-callee-shapes.controller.ts');
    await discover('mixin-namespace.controller.ts');
    // A warning that fires on working code is a warning nobody reads.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('unresolvable factory heritage', () => {
  it('warns naming the file, the class and the callee', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await discover('mixin-unresolvable-factory.controller.ts');

    const messages = warn.mock.calls.map((c) => String(c[0]));
    const message = messages.find((m) => m.includes('SearchUnresolvableController'));
    expect(
      message,
      `no warning for the unresolvable controller; got: ${messages.join(' | ')}`,
    ).toBeDefined();
    expect(message).toContain('mixin-unresolvable-factory.controller.ts');
    expect(message).toContain('makeTableController()');
    // Says what it costs, since the symptom (a controller missing from the
    // client) carries no error of its own.
    expect(message).toContain('NO routes');
  });

  it('drops the controller rather than emitting a broken one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const routes = await discover('mixin-unresolvable-factory.controller.ts');
    // The warning replaces silence, not behaviour: the unresolved controller
    // still contributes nothing, and its neighbours still generate.
    expect(routes.map((r) => r.path)).toEqual(['/plain-base']);
  });

  it('warns exactly once — not for a plain base class, nor for a non-controller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await discover('mixin-unresolvable-factory.controller.ts');
    // The same unresolvable call appears on a class without `@Controller`, and a
    // second controller extends an ordinary base class. Warning on either would
    // fire across normal codebases and bury the line that matters.
    expect(warn.mock.calls.map((c) => String(c[0]))).toHaveLength(1);
  });
});
