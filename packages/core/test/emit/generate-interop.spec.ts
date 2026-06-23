import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/load-config.js';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import type { CodegenExtension } from '../../src/extension/types.js';
import { generate } from '../../src/generate.js';

const routes: RouteDescriptor[] = [
  {
    method: 'GET',
    path: '/api/users/:id',
    name: 'users.show',
    params: [{ name: 'id', source: 'path' }],
    contract: {
      contractSource: { query: null, body: null, response: 'User', error: '{ message: string }' },
    },
  },
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('generate() interop targets', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'codegen-interop-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('does not emit openapi.json / mocks.ts by default', async () => {
    const config = resolveConfig({ validation: zodAdapter, codegen: { outDir } }, outDir);
    await generate(config, routes);
    expect(await exists(join(outDir, 'openapi.json'))).toBe(false);
    expect(await exists(join(outDir, 'mocks.ts'))).toBe(false);
  });

  it('emits openapi.json when opted in', async () => {
    const config = resolveConfig(
      { validation: zodAdapter, codegen: { outDir }, openapi: { enabled: true, title: 'X' } },
      outDir,
    );
    await generate(config, routes);
    const raw = await readFile(join(outDir, 'openapi.json'), 'utf8');
    const spec = JSON.parse(raw);
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('X');
    expect(spec.paths['/api/users/{id}'].get.operationId).toBe('users.show');
  });

  it('emits mocks.ts when opted in', async () => {
    const config = resolveConfig(
      { validation: zodAdapter, codegen: { outDir }, mocks: { enabled: true, seed: 3 } },
      outDir,
    );
    await generate(config, routes);
    const src = await readFile(join(outDir, 'mocks.ts'), 'utf8');
    expect(src).toContain('export const handlers = [');
    expect(src).toContain('const SEED = 3;');
    expect(src).toContain('// users.show');
  });

  it('route-injecting extension does not clobber contract routes on second generate() call', async () => {
    // Regression: pages watcher used to call generate(config) with no routes, so a
    // route-injecting extension's transformRoutes would produce an extension-only api.ts,
    // dropping every contract-derived route. Passing contractRoutes prevents the clobber.
    const injectedRoute: RouteDescriptor = {
      method: 'POST',
      path: '/api/notifications',
      name: 'notifications.create',
      params: [],
      contract: {
        contractSource: {
          query: null,
          body: 'CreateNotificationDto',
          response: 'void',
          error: null,
        },
      },
    };
    const injectingExtension: CodegenExtension = {
      name: 'injecting-extension',
      transformRoutes(existingRoutes) {
        return [...existingRoutes, injectedRoute];
      },
    };
    const config = resolveConfig(
      { validation: zodAdapter, codegen: { outDir }, extensions: [injectingExtension] },
      outDir,
    );

    // First call establishes the full api.ts with both contract + injected routes.
    await generate(config, routes);
    // Second call simulates a pages-watcher regen: contractRoutes passed in (not empty).
    await generate(config, routes);

    const apiTs = await readFile(join(outDir, 'api.ts'), 'utf8');
    // Original contract route must still be present.
    expect(apiTs).toContain('users');
    // Injected route must also be present (extension still runs).
    expect(apiTs).toContain('notifications');
  });
});
