import { describe, expect, it } from 'vitest';
import { defineExtension } from '../../src/extension/index.js';
import type {
  ApiClientLayer,
  ApiTransport,
  CodegenExtension,
  LeafModel,
} from '../../src/extension/index.js';

describe('extension contract', () => {
  it('defineExtension returns the extension unchanged', () => {
    const ext: CodegenExtension = { name: 'noop' };
    expect(defineExtension(ext)).toBe(ext);
  });

  it('an extension can declare every hook (compiles + is callable)', () => {
    const transport: ApiTransport = {
      name: 'fetcher',
      renderRequest: (leaf) => `fetcher.${leaf.request.method}(${leaf.request.urlExpr})`,
      imports: () => ["import type { Fetcher } from '@dudousxd/nestjs-client';"],
    };
    const layer: ApiClientLayer = {
      name: 'tanstack',
      buildMembers: (requestExpr, _leaf) => ({ fetch: `() => ${requestExpr}` }),
    };
    const ext = defineExtension({
      name: 'full',
      transformRoutes: (routes) => routes,
      emitFiles: () => [{ path: 'extra.d.ts', contents: '// extra' }],
      apiHeader: () => ({
        imports: ["import { x } from 'y';"],
        statements: ['export const z = 1;'],
      }),
      apiMembers: (leaf: LeafModel) =>
        leaf.route.contract ? { filterQuery: '() => filterQueryTyped()' } : undefined,
      apiTransport: transport,
      apiClientLayer: layer,
    });

    expect(ext.name).toBe('full');
    expect(ext.apiTransport?.name).toBe('fetcher');
    expect(
      ext.apiClientLayer?.buildMembers('fetcher.get(u)', {} as LeafModel, {} as never),
    ).toEqual({
      fetch: '() => fetcher.get(u)',
    });
    expect(ext.emitFiles?.({} as never)).toEqual([{ path: 'extra.d.ts', contents: '// extra' }]);
  });
});
