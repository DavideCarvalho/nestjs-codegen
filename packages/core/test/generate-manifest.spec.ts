import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../src/config/types.js';
import { MANIFEST_FILE, readManifest } from '../src/generate-manifest.js';
import { generate } from '../src/generate.js';

// Pages-only config: generate completes without controllers (and without touching
// openapi/mocks), so these tests exercise the skip path on real output files.
function makeConfig(cwd: string, outDir: string): ResolvedConfig {
  return {
    debug: false,
    extensions: [],
    validation: zodAdapter,
    pages: {
      glob: '**/*.tsx',
      propsExport: 'ComponentProps',
      componentNameStrategy: 'relative-no-ext',
    },
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
  };
}

describe('generate skip-when-unchanged', () => {
  let tmpBase: string;
  let pagesDir: string;
  let outDir: string;
  let config: ResolvedConfig;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), 'gen-manifest-'));
    pagesDir = join(tmpBase, 'pages');
    outDir = join(tmpBase, '.out');
    await mkdir(pagesDir, { recursive: true });
    await writeFile(
      join(pagesDir, 'Home.tsx'),
      'export type ComponentProps = { title: string };\nexport default function Home() { return null; }\n',
      'utf8',
    );
    config = makeConfig(pagesDir, outDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpBase, { recursive: true, force: true });
  });

  it('writes a manifest with the inputs hash + output files on first run', async () => {
    await generate(config);

    const manifest = await readManifest(outDir);
    expect(manifest).not.toBeNull();
    expect(manifest?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest?.files).toContain('pages.d.ts');
    expect(manifest?.files).not.toContain(MANIFEST_FILE);
  });

  it('skips regeneration when nothing changed (output left untouched)', async () => {
    await generate(config);

    // Tamper with an output file; a skip must leave it untouched.
    await writeFile(join(outDir, 'pages.d.ts'), 'SENTINEL', 'utf8');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await generate(config);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date, skipped'));
    expect(await readFile(join(outDir, 'pages.d.ts'), 'utf8')).toBe('SENTINEL');
  });

  it('regenerates when an input source file changes', async () => {
    await generate(config);
    await writeFile(join(outDir, 'pages.d.ts'), 'SENTINEL', 'utf8');

    // Add a new page → inputs hash changes → must regenerate.
    await writeFile(
      join(pagesDir, 'About.tsx'),
      'export type ComponentProps = { subtitle: string };\nexport default function About() { return null; }\n',
      'utf8',
    );

    await generate(config);

    const content = await readFile(join(outDir, 'pages.d.ts'), 'utf8');
    expect(content).not.toBe('SENTINEL');
    expect(content).toContain('About');
  });

  it('regenerates when a recorded output file is missing', async () => {
    await generate(config);

    // Delete an output while leaving the manifest in place: hash still matches but
    // the recorded file is gone, so the run must regenerate rather than skip.
    await unlink(join(outDir, 'pages.d.ts'));

    await generate(config);

    const content = await readFile(join(outDir, 'pages.d.ts'), 'utf8');
    expect(content).toContain('Home');
  });

  it('regenerates when the manifest is absent (e.g. outDir was wiped)', async () => {
    await generate(config);
    await unlink(join(outDir, MANIFEST_FILE));
    await writeFile(join(outDir, 'pages.d.ts'), 'SENTINEL', 'utf8');

    await generate(config);

    expect(await readFile(join(outDir, 'pages.d.ts'), 'utf8')).not.toBe('SENTINEL');
  });
});
