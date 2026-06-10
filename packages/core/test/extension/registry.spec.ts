import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import { CodegenError } from '../../src/exceptions.js';
import {
  applyTransformRoutes,
  collectEmittedFiles,
  createExtensionContext,
} from '../../src/extension/registry.js';
import type { CodegenExtension } from '../../src/extension/types.js';

function fakeConfig(extensions: CodegenExtension[]): ResolvedConfig {
  return {
    extensions,
    validation: { name: 'zod' } as never,
    mutationClient: 'fetcher',
    queryImport: '@tanstack/react-query',
    query: false,
    pages: null,
    contracts: { glob: 'src/**/*.controller.ts', debounceMs: 500 },
    scopes: {},
    codegen: { outDir: '/tmp/out', cwd: '/tmp' },
    app: null,
    fetcher: null,
    forms: { enabled: true, watch: 'src/**/*.dto.ts', zodImport: 'zod' },
  };
}

const route: RouteDescriptor = {
  method: 'GET',
  path: '/api/users',
  name: 'users.list',
  params: [],
  contract: { contractSource: { query: null, body: null, response: 'User[]' } },
};

describe('applyTransformRoutes', () => {
  it('chains extensions in order (each sees the previous output)', async () => {
    const order: string[] = [];
    const exts: CodegenExtension[] = [
      {
        name: 'a',
        transformRoutes: (routes) => {
          order.push('a');
          return [...routes, { ...route, name: 'a.added' }];
        },
      },
      {
        name: 'b',
        transformRoutes: (routes) => {
          order.push(`b:${routes.length}`);
          // mutate-in-place + return void
          routes[0].path = '/api/v2/users';
        },
      },
    ];
    const ctx = createExtensionContext(fakeConfig(exts), () => [route]);
    const result = await applyTransformRoutes([{ ...route }], exts, ctx);
    expect(order).toEqual(['a', 'b:2']);
    expect(result.map((r) => r.name)).toEqual(['users.list', 'a.added']);
    expect(result[0].path).toBe('/api/v2/users');
  });
});

describe('collectEmittedFiles', () => {
  it('accumulates files from all extensions', async () => {
    const exts: CodegenExtension[] = [
      { name: 'a', emitFiles: () => [{ path: 'a.d.ts', contents: '// a' }] },
      { name: 'b', emitFiles: () => [{ path: 'b.json', contents: '{}' }] },
    ];
    const ctx = createExtensionContext(fakeConfig(exts), () => []);
    const files = await collectEmittedFiles(exts, ctx);
    expect(files.map((f) => f.path)).toEqual(['a.d.ts', 'b.json']);
  });

  it('throws when two extensions emit the same path', async () => {
    const exts: CodegenExtension[] = [
      { name: 'a', emitFiles: () => [{ path: 'shared.ts', contents: '1' }] },
      { name: 'b', emitFiles: () => [{ path: './shared.ts', contents: '2' }] },
    ];
    const ctx = createExtensionContext(fakeConfig(exts), () => []);
    await expect(collectEmittedFiles(exts, ctx)).rejects.toBeInstanceOf(CodegenError);
  });

  it('throws when an extension emits a core-owned file', async () => {
    const exts: CodegenExtension[] = [
      { name: 'evil', emitFiles: () => [{ path: 'api.ts', contents: '// nope' }] },
    ];
    const ctx = createExtensionContext(fakeConfig(exts), () => []);
    await expect(collectEmittedFiles(exts, ctx)).rejects.toThrow(/core-owned/);
  });
});

describe('createExtensionContext', () => {
  it('exposes a live routes getter + a lazy ts-morph project', () => {
    let routes: readonly RouteDescriptor[] = [];
    const ctx = createExtensionContext(fakeConfig([]), () => routes);
    expect(ctx.routes).toEqual([]);
    routes = [route];
    expect(ctx.routes).toEqual([route]);
    expect(ctx.project()).toBe(ctx.project()); // same instance, created once
  });
});
