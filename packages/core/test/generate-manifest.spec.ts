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

/**
 * Extension-declared inputs (`ExtensionContext.trackInput`).
 *
 * The freshness hash is built from the host's own globs. An extension that
 * reads outside them — the filter extension resolves each route's
 * `@ApplyFilter(FilterClass)` target and reads its `@Filterable`/`@Computed`
 * declarations — used to produce output nothing could invalidate: editing that
 * file left the hash untouched and the next run reported "up to date, skipped"
 * while serving stale types.
 */
describe('generate skip-when-unchanged with extension-tracked inputs', () => {
  let tmpBase: string;
  let pagesDir: string;
  let outDir: string;
  let sidecar: string;
  let config: ResolvedConfig;

  /** An extension that depends on a file no host glob matches. */
  function trackingExtension(path: string) {
    return {
      name: 'tracking-test-extension',
      transformRoutes(routes: unknown, ctx: { trackInput: (...p: string[]) => void }) {
        ctx.trackInput(path);
        return routes as never;
      },
    };
  }

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), 'gen-manifest-tracked-'));
    pagesDir = join(tmpBase, 'pages');
    outDir = join(tmpBase, '.out');
    await mkdir(pagesDir, { recursive: true });
    await writeFile(
      join(pagesDir, 'Home.tsx'),
      'export type ComponentProps = { title: string };\nexport default function Home() { return null; }\n',
      'utf8',
    );
    // `.filter.ts` matches neither the pages glob (**/*.tsx), the contracts
    // glob (src/**/*.controller.ts) nor the forms glob (src/**/*.dto.ts).
    sidecar = join(pagesDir, 'mvr.filter.ts');
    await writeFile(sidecar, 'export const computed = { firstVisit: 1 };\n', 'utf8');

    config = makeConfig(pagesDir, outDir);
    config.extensions = [trackingExtension(sidecar) as never];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpBase, { recursive: true, force: true });
  });

  it('records tracked paths in the manifest, relative to cwd', async () => {
    await generate(config);

    expect((await readManifest(outDir))?.extraInputs).toEqual(['mvr.filter.ts']);
  });

  it('still skips when neither the globbed inputs nor the tracked file changed', async () => {
    await generate(config);
    await writeFile(join(outDir, 'pages.d.ts'), 'SENTINEL', 'utf8');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await generate(config);

    // The re-hash on write must be reproducible, or this would regenerate on
    // every run once an extension tracks anything.
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date, skipped'));
    expect(await readFile(join(outDir, 'pages.d.ts'), 'utf8')).toBe('SENTINEL');
  });

  it('regenerates when a tracked file changes', async () => {
    await generate(config);
    await writeFile(join(outDir, 'pages.d.ts'), 'SENTINEL', 'utf8');

    // The whole point: no glob matches this file, so before the fix the hash
    // was unchanged and the run skipped.
    await writeFile(sidecar, 'export const computed = { firstVisit: 1, lastVisit: 2 };\n', 'utf8');

    await generate(config);

    expect(await readFile(join(outDir, 'pages.d.ts'), 'utf8')).not.toBe('SENTINEL');
  });

  it('regenerates when a tracked file is deleted', async () => {
    await generate(config);
    await writeFile(join(outDir, 'pages.d.ts'), 'SENTINEL', 'utf8');

    await unlink(sidecar);

    // A vanished dependency hashes as a `missing` marker rather than throwing.
    await generate(config);

    expect(await readFile(join(outDir, 'pages.d.ts'), 'utf8')).not.toBe('SENTINEL');
  });

  it('ignores tracking of a file the globs already cover', async () => {
    config.extensions = [trackingExtension(join(pagesDir, 'Home.tsx')) as never];
    await generate(config);
    await writeFile(join(outDir, 'pages.d.ts'), 'SENTINEL', 'utf8');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await generate(config);

    // Hashed once, not twice — double-hashing would still be deterministic, so
    // what this really pins is that the dedup does not break the skip path.
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date, skipped'));
    expect(await readFile(join(outDir, 'pages.d.ts'), 'utf8')).toBe('SENTINEL');
  });
});
