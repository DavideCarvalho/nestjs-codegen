import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../src/config/types.js';
import type { CodegenExtension } from '../src/extension/types.js';

/**
 * A generate pass reads its inputs for the freshness hash, again for the hash it
 * records once extensions have reported their dependencies, and page discovery
 * reads the pages. All three see the same files, so each is read once per pass.
 */

const reads = vi.hoisted(() => new Map<string, number>());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = ((path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
    const key = String(path);
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
  }) as typeof actual.readFile;
  return { ...actual, readFile, default: { ...actual, readFile } };
});

const { generate } = await import('../src/generate.js');

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function put(root: string, rel: string, text: string): Promise<string> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
  return abs;
}

/** Reports a file outside every glob as an input, the way the filter extension does. */
const tracker: CodegenExtension = {
  name: 'tracker',
  transformRoutes(routes, ctx) {
    ctx.trackInput('src/filters/notes.filter.ts');
    return routes;
  },
};

function makeConfig(cwd: string): ResolvedConfig {
  return {
    debug: false,
    extensions: [tracker],
    validation: zodAdapter,
    pages: {
      glob: 'pages/**/*.tsx',
      propsExport: 'ComponentProps',
      componentNameStrategy: 'relative-no-ext',
    },
    contracts: { glob: 'src/**/*.controller.ts', debounceMs: 500 },
    scopes: {},
    codegen: { outDir: join(cwd, '.out'), cwd },
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

const PAGE = (name: string) =>
  `export type ComponentProps = { ${name}: string };\nexport default function P() { return null; }\n`;

describe('generate input reads', () => {
  it('reads every input file once per pass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegen-input-reads-'));
    roots.push(root);
    await put(root, 'tsconfig.json', '{}');
    const inputs = [
      await put(root, 'src/notes.controller.ts', 'export class NotesController {}\n'),
      await put(root, 'src/tags.controller.ts', 'export class TagsController {}\n'),
      await put(root, 'src/note.dto.ts', 'export class NoteDto {}\n'),
      await put(root, 'src/filters/notes.filter.ts', 'export class NotesFilter {}\n'),
      await put(root, 'pages/Home.tsx', PAGE('title')),
    ];
    const about = await put(root, 'pages/About.tsx', PAGE('subtitle'));
    inputs.push(about);
    const config = makeConfig(root);

    // The first pass records the tracked file in the manifest; the second hashes it.
    await generate(config, []);
    await put(root, 'pages/About.tsx', PAGE('heading'));
    reads.clear();
    await generate(config, []);

    expect(Object.fromEntries(inputs.map((file) => [file, reads.get(file) ?? 0]))).toEqual(
      Object.fromEntries(inputs.map((file) => [file, 1])),
    );
  });
});
