import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';

/**
 * Shared-props discovery runs on every generate pass, so once per change in watch
 * mode. Parsing a tsconfig into a Project also lists every file it includes, a walk
 * of the project tree; the parse is reused while the tsconfig is unchanged.
 */

const parsedFromTsconfig = vi.hoisted(() => ({ count: 0 }));

vi.mock('ts-morph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ts-morph')>();
  class CountedProject extends actual.Project {
    constructor(...args: ConstructorParameters<typeof actual.Project>) {
      super(...args);
      if (args[0]?.tsConfigFilePath) parsedFromTsconfig.count++;
    }
  }
  return { ...actual, Project: CountedProject };
});

const { discoverSharedPropsFromConfig } = await import('../../src/discovery/shared-props.js');

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function put(root: string, rel: string, text: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
}

const tsconfig = (target: string) =>
  JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': [`${target}/*`] } } });

async function scaffold(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codegen-shared-props-tsconfig-'));
  roots.push(root);
  await put(root, 'tsconfig.json', tsconfig('src'));
  for (const dir of ['src', 'lib']) {
    await put(
      root,
      `${dir}/shared.ts`,
      'export function buildShared() {\n  return { user: null as string | null };\n}\n',
    );
  }
  await put(
    root,
    'src/app.module.ts',
    `import { buildShared } from '@/shared';
const InertiaModule = { forRoot: (options: unknown) => options };
export const imports = [InertiaModule.forRoot({ share: buildShared })];
`,
  );
  return root;
}

const configFor = (root: string) =>
  ({
    app: { moduleEntry: join(root, 'src/app.module.ts'), tsconfig: null },
    codegen: { cwd: root },
  }) as unknown as ResolvedConfig;

describe('discoverSharedPropsFromConfig across passes', () => {
  it('parses the tsconfig once while it is unchanged', async () => {
    const root = await scaffold();
    const config = configFor(root);

    parsedFromTsconfig.count = 0;
    const results = [1, 2, 3].map(() => discoverSharedPropsFromConfig(config));

    expect(parsedFromTsconfig.count).toBe(1);
    expect(results[0]?.typeString).toContain(join(root, 'src/shared'));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('parses it again once it changes, resolving through the new paths', async () => {
    const root = await scaffold();
    const config = configFor(root);
    discoverSharedPropsFromConfig(config);

    await put(root, 'tsconfig.json', tsconfig('lib'));
    parsedFromTsconfig.count = 0;
    const result = discoverSharedPropsFromConfig(config);

    expect(parsedFromTsconfig.count).toBe(1);
    expect(result?.typeString).toContain(join(root, 'lib/shared'));
  });
});
