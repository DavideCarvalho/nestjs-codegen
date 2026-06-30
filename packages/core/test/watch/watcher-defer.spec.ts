import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';

// Mock the heavy pieces so we control exactly when the initial generate resolves.
// The watcher's lock + chokidar setup still run against a real tmp dir.
const generateMock = vi.fn();
vi.mock('../../src/generate.js', () => ({
  generate: (...args: unknown[]) => generateMock(...args),
}));
vi.mock('../../src/discovery/contracts-fast.js', () => ({
  PersistentDiscovery: {
    create: async () => ({
      discover: () => [],
      rediscover: async () => [],
    }),
  },
}));

import { watch } from '../../src/watch/watcher.js';

function makeConfig(outDir: string, cwd: string): ResolvedConfig {
  return {
    debug: false,
    extensions: [],
    validation: zodAdapter,
    pages: null,
    contracts: { glob: 'src/**/*.controller.ts', debounceMs: 500 },
    scopes: {},
    codegen: { outDir, cwd },
    app: null,
    fetcher: null,
    serialization: 'json',
    forms: { enabled: true, watch: 'src/**/*.dto.ts', zodImport: 'zod' },
    openapi: {
      enabled: false,
      fileName: 'openapi.json',
      title: 't',
      version: '1',
      description: null,
    },
    mocks: { enabled: false, fileName: 'mocks.ts', seed: 1, baseUrl: '' },
  };
}

describe('watch(deferInitialGenerate)', () => {
  let tmpBase: string;
  const watchers: Array<{ close(): Promise<void> }> = [];

  beforeEach(() => {
    generateMock.mockReset();
  });

  afterEach(async () => {
    for (const w of watchers) await w.close();
    watchers.length = 0;
    if (tmpBase) await rm(tmpBase, { recursive: true, force: true });
  });

  it('returns before the initial generate completes when deferInitialGenerate is true', async () => {
    tmpBase = await mkdtemp(join(tmpdir(), 'watcher-defer-'));
    const config = makeConfig(join(tmpBase, '.out'), tmpBase);

    const order: string[] = [];
    let resolveGenerate: () => void = () => {};
    const generateDone = new Promise<void>((resolve) => {
      resolveGenerate = resolve;
    });
    generateDone.then(() => order.push('generate-resolved'));
    generateMock.mockReturnValue(generateDone);

    const watcher = await watch(config, undefined, { deferInitialGenerate: true });
    watchers.push(watcher);
    order.push('watch-returned');

    // The background pass awaits discovery before calling generate; let it reach the
    // generate call. The watcher has already returned, so it never blocked on it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['watch-returned']);

    // Now let the background generate finish.
    resolveGenerate();
    await generateDone;
    expect(order).toEqual(['watch-returned', 'generate-resolved']);
  });

  it('awaits the initial generate by default (blocking — used by the CLI)', async () => {
    tmpBase = await mkdtemp(join(tmpdir(), 'watcher-block-'));
    const config = makeConfig(join(tmpBase, '.out'), tmpBase);

    let resolveGenerate: () => void = () => {};
    const generateDone = new Promise<void>((resolve) => {
      resolveGenerate = resolve;
    });
    generateMock.mockReturnValue(generateDone);

    let watchResolved = false;
    const watchPromise = watch(config, undefined).then((watcher) => {
      watchResolved = true;
      return watcher;
    });

    // Give microtasks a chance — watch must still be blocked on the pending generate.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(watchResolved).toBe(false);

    resolveGenerate();
    const watcher = await watchPromise;
    watchers.push(watcher);
    expect(watchResolved).toBe(true);
  });

  it('a rejected background generate never surfaces as an unhandled rejection', async () => {
    tmpBase = await mkdtemp(join(tmpdir(), 'watcher-defer-reject-'));
    const config = makeConfig(join(tmpBase, '.out'), tmpBase);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateMock.mockRejectedValue(new Error('boom'));

    const watcher = await watch(config, undefined, { deferInitialGenerate: true });
    watchers.push(watcher);

    // Let the rejected initial pass settle; the fallback also rejects, both swallowed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    warnSpy.mockRestore();
    // Reaching here without an unhandled-rejection crash is the assertion.
    expect(generateMock).toHaveBeenCalled();
  });
});
