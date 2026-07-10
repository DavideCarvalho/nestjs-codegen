/**
 * CLI ↔ Nest-module config-drift guard (Feature: driftGuard).
 *
 * Both entry points can target the same `outDir`. If their resolved configs
 * differ (classic case: `serialization` `'json'` vs `'superjson'`), each run
 * would otherwise silently rewrite `api.ts` to its own shape — a ping-pong
 * churn. `generate()` refuses to proceed (throws `DriftGuardError`, BEFORE
 * writing anything) when the manifest's `entryPoint` differs from the current
 * run's AND the manifest's `configHash` differs from the current run's.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '../src/config/types.js';
import { DriftGuardError, readManifest } from '../src/generate-manifest.js';
import { generate } from '../src/generate.js';

function makeConfig(
  cwd: string,
  outDir: string,
  overrides: Partial<ResolvedConfig> = {},
): ResolvedConfig {
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
    driftGuard: true,
    ...overrides,
  };
}

describe('generate() drift guard', () => {
  let tmpBase: string;
  let outDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), 'gen-drift-'));
    outDir = join(tmpBase, '.out');
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it('throws DriftGuardError when cli then module run with a genuinely different config', async () => {
    const cliConfig = makeConfig(tmpBase, outDir, { serialization: 'json' });
    await generate(cliConfig, [], 'cli');

    const moduleConfig = makeConfig(tmpBase, outDir, { serialization: 'superjson' });
    await expect(generate(moduleConfig, [], 'module')).rejects.toThrow(DriftGuardError);
    await expect(generate(moduleConfig, [], 'module')).rejects.toThrow(/config drift/i);
  });

  it('names both entry points and instructs how to fix it in the error message', async () => {
    const cliConfig = makeConfig(tmpBase, outDir, { serialization: 'json' });
    await generate(cliConfig, [], 'cli');
    const moduleConfig = makeConfig(tmpBase, outDir, { serialization: 'superjson' });

    try {
      await generate(moduleConfig, [], 'module');
      expect.unreachable('expected generate() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DriftGuardError);
      const message = (err as Error).message;
      expect(message).toContain('"cli"');
      expect(message).toContain('"module"');
      expect(message).toContain('driftGuard: false');
    }
  });

  it('does not write/overwrite output when drift is detected', async () => {
    const cliConfig = makeConfig(tmpBase, outDir, { serialization: 'json' });
    await generate(cliConfig, [], 'cli');
    const manifestBefore = await readManifest(outDir);

    const moduleConfig = makeConfig(tmpBase, outDir, { serialization: 'superjson' });
    await expect(generate(moduleConfig, [], 'module')).rejects.toThrow(DriftGuardError);

    const manifestAfter = await readManifest(outDir);
    expect(manifestAfter).toEqual(manifestBefore);
  });

  it('same entry point + different config regenerates normally (a normal config edit)', async () => {
    const first = makeConfig(tmpBase, outDir, { serialization: 'json' });
    await generate(first, [], 'cli');

    const second = makeConfig(tmpBase, outDir, { serialization: 'superjson' });
    await expect(generate(second, [], 'cli')).resolves.toBeUndefined();

    const manifest = await readManifest(outDir);
    expect(manifest?.entryPoint).toBe('cli');
  });

  it('different entry point + SAME configHash proceeds and updates entryPoint', async () => {
    const cliConfig = makeConfig(tmpBase, outDir);
    await generate(cliConfig, [], 'cli');

    // Touch a source file so the combined inputs hash changes and this run isn't
    // skipped by the freshness check — otherwise the identical-config case never
    // reaches the manifest write, and entryPoint would trivially stay 'cli'. The
    // resolved CONFIG itself (and therefore configHash) stays identical.
    await mkdir(join(tmpBase, 'src'), { recursive: true });
    await writeFile(join(tmpBase, 'src', 'x.controller.ts'), '// noop\n', 'utf8');

    const moduleConfig = makeConfig(tmpBase, outDir);
    await expect(generate(moduleConfig, [], 'module')).resolves.toBeUndefined();

    const manifest = await readManifest(outDir);
    expect(manifest?.entryPoint).toBe('module');
  });

  it('driftGuard: false bypasses the check even with a genuinely different config', async () => {
    const cliConfig = makeConfig(tmpBase, outDir, { serialization: 'json', driftGuard: false });
    await generate(cliConfig, [], 'cli');

    const moduleConfig = makeConfig(tmpBase, outDir, {
      serialization: 'superjson',
      driftGuard: false,
    });
    await expect(generate(moduleConfig, [], 'module')).resolves.toBeUndefined();

    const manifest = await readManifest(outDir);
    expect(manifest?.entryPoint).toBe('module');
  });

  it('a fresh outDir (no prior manifest) never trips the guard', async () => {
    const config = makeConfig(tmpBase, outDir);
    await expect(generate(config, [], 'module')).resolves.toBeUndefined();
    const manifest = await readManifest(outDir);
    expect(manifest?.entryPoint).toBe('module');
    expect(manifest?.configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('defaults entryPoint to "cli" when generate() is called without a third argument', async () => {
    const config = makeConfig(tmpBase, outDir);
    await generate(config);
    const manifest = await readManifest(outDir);
    expect(manifest?.entryPoint).toBe('cli');
  });
});
