import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';
import { CodegenError } from '../../src/exceptions.js';
import {
  DEFAULT_SANDBOX_KIT_OUTPUT,
  type WriteSandboxKitDocsOptions,
  genuiSandboxKit,
} from '../../src/extension/genui-sandbox-kit.js';
import { createExtensionContext } from '../../src/extension/registry.js';
import type { CodegenExtension } from '../../src/extension/types.js';
import { readManifest } from '../../src/generate-manifest.js';
import { generate } from '../../src/generate.js';
import { watch } from '../../src/watch/watcher.js';

function makeConfig(cwd: string, extensions: CodegenExtension[]): ResolvedConfig {
  return {
    debug: false,
    extensions,
    validation: zodAdapter,
    pages: null,
    contracts: { glob: 'src/**/*.controller.ts', debounceMs: 100 },
    scopes: {},
    codegen: { outDir: join(cwd, 'src/generated'), cwd },
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

/** A fake `writeSandboxKitDocs`: records its calls and writes `output` like the real one. */
function fakeWriter() {
  const calls: WriteSandboxKitDocsOptions[] = [];
  const generateDocs = vi.fn(async (options: WriteSandboxKitDocsOptions) => {
    calls.push(options);
    const path = resolve(options.root, options.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"version":1,"components":[]}\n', 'utf8');
    return { version: 1, components: [] };
  });
  return { calls, generateDocs };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('genuiSandboxKit', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'genui-kit-'));
    await mkdir(join(cwd, 'src/components/ui'), { recursive: true });
    await writeFile(
      join(cwd, 'src/components/ui/button.tsx'),
      'export function Button() { return null; }\n',
    );
    await writeFile(
      join(cwd, 'src/components/ui/card.tsx'),
      'export function Card() { return null; }\n',
    );
    await mkdir(join(cwd, 'src/styles'), { recursive: true });
    await writeFile(join(cwd, 'src/styles/app.css'), ':root { --primary: red; }\n');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true });
  });

  it('calls the generator with root = cwd and the options, and tracks kit + css + output', async () => {
    const { calls, generateDocs } = fakeWriter();
    const ext = genuiSandboxKit({
      include: 'src/components/ui/*.tsx',
      css: 'src/styles/*.css',
      tsconfig: 'tsconfig.app.json',
      generate: generateDocs,
    });
    const tracked = new Set<string>();
    const ctx = createExtensionContext(makeConfig(cwd, [ext]), () => [], tracked);

    const files = await ext.emitFiles?.(ctx);

    expect(files).toEqual([]);
    expect(calls).toEqual([
      {
        root: cwd,
        output: DEFAULT_SANDBOX_KIT_OUTPUT,
        include: 'src/components/ui/*.tsx',
        css: 'src/styles/*.css',
        tsconfig: 'tsconfig.app.json',
      },
    ]);
    expect([...tracked].sort()).toEqual(
      [
        'src/components/ui/button.tsx',
        'src/components/ui/card.tsx',
        'src/components/ui',
        'src/styles/app.css',
        '.genui/sandbox-kit.json',
      ].sort(),
    );
  });

  it('passes entry and a custom output through, tracking the entry and its directory', async () => {
    const { calls, generateDocs } = fakeWriter();
    const ext = genuiSandboxKit({
      entry: 'src/components/ui/button.tsx',
      output: 'var/kit.json',
      generate: generateDocs,
    });
    const tracked = new Set<string>();
    await ext.emitFiles?.(createExtensionContext(makeConfig(cwd, [ext]), () => [], tracked));

    expect(calls).toEqual([
      { root: cwd, output: 'var/kit.json', entry: 'src/components/ui/button.tsx' },
    ]);
    expect([...tracked].sort()).toEqual(
      ['src/components/ui/button.tsx', 'src/components/ui', 'var/kit.json'].sort(),
    );
  });

  it('falls back to the default shadcn components/ui dir when neither entry nor include is set', async () => {
    const { generateDocs } = fakeWriter();
    const ext = genuiSandboxKit({ generate: generateDocs });
    const tracked = new Set<string>();
    await ext.emitFiles?.(createExtensionContext(makeConfig(cwd, [ext]), () => [], tracked));

    expect(tracked).toContain('src/components/ui/button.tsx');
    expect(tracked).toContain('src/components/ui');
  });

  it('throws a clear error when @dudousxd/nestjs-agent-core is not installed', async () => {
    const ext = genuiSandboxKit();
    const ctx = createExtensionContext(makeConfig(cwd, [ext]), () => []);
    const run = ext.emitFiles?.(ctx);
    await expect(run).rejects.toBeInstanceOf(CodegenError);
    await expect(run).rejects.toThrow(/@dudousxd\/nestjs-agent-core@>=0\.50\.0/);
  });

  it('runs during generate(): skips when unchanged, reruns on a kit edit, a new component, or a deleted descriptor', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { generateDocs } = fakeWriter();
    const config = makeConfig(cwd, [genuiSandboxKit({ generate: generateDocs })]);

    await generate(config);
    expect(generateDocs).toHaveBeenCalledTimes(1);
    expect(await readFile(join(cwd, '.genui/sandbox-kit.json'), 'utf8')).toContain('"version":1');
    expect((await readManifest(config.codegen.outDir))?.extraInputs).toContain(
      'src/components/ui/button.tsx',
    );

    await generate(config);
    expect(generateDocs).toHaveBeenCalledTimes(1);

    await writeFile(
      join(cwd, 'src/components/ui/button.tsx'),
      'export function Button(props: { label: string }) { return null; }\n',
    );
    await generate(config);
    expect(generateDocs).toHaveBeenCalledTimes(2);

    await writeFile(
      join(cwd, 'src/components/ui/badge.tsx'),
      'export function Badge() { return null; }\n',
    );
    await generate(config);
    expect(generateDocs).toHaveBeenCalledTimes(3);

    await unlink(join(cwd, '.genui/sandbox-kit.json'));
    await generate(config);
    expect(generateDocs).toHaveBeenCalledTimes(4);
  });

  it('regenerates in watch mode when a kit component changes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { generateDocs } = fakeWriter();
    const config = makeConfig(cwd, [genuiSandboxKit({ generate: generateDocs })]);
    let changes = 0;
    const watcher = await watch(config, () => {
      changes++;
    });
    try {
      expect(generateDocs).toHaveBeenCalledTimes(1);
      // Give chokidar time to set up the tracked-inputs watcher.
      await new Promise((r) => setTimeout(r, 400));
      await writeFile(
        join(cwd, 'src/components/ui/card.tsx'),
        'export function Card(props: { title: string }) { return null; }\n',
      );
      await waitFor(() => generateDocs.mock.calls.length >= 2 && changes > 0);
    } finally {
      await watcher.close();
    }
  });
});
