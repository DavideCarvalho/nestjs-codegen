/**
 * Several page globs, and several Inertia apps (scopes) in one codegen run.
 *
 * Fixture `pages-multi`:
 *   web/pages/{Home,users/Show}.tsx   the default app
 *   shared/pages/Login.tsx            more pages of the default app, in another directory
 *   minimal/pages/{Home,Due}.tsx      a second Inertia app (`InertiaModule.forFeature({ scope: 'minimal' })`)
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../../src/config/load-config.js';
import { discoverPageScopes, discoverPages } from '../../src/discovery/pages.js';
import { computeInputsHash } from '../../src/generate-manifest.js';
import { generate } from '../../src/generate.js';

const cwd = resolve(__dirname, '../__fixtures__/pages-multi');
const base = { propsExport: 'ComponentProps', componentNameStrategy: 'relative-no-ext' } as const;

describe('discoverPages with several globs', () => {
  it('names each page relative to the static base of the glob that matched it', async () => {
    const pages = await discoverPages({
      ...base,
      cwd,
      glob: ['web/pages/**/*.tsx', 'shared/pages/**/*.tsx'],
    });
    expect(pages.map((p) => p.name).sort()).toEqual(['Home', 'Login', 'users/Show']);
  });

  it('takes the static base of a brace glob up to its first magic segment', async () => {
    const pages = await discoverPages({ ...base, cwd, glob: '{web,shared}/pages/**/*.tsx' });
    expect(pages.map((p) => p.name).sort()).toEqual([
      'shared/pages/Login',
      'web/pages/Home',
      'web/pages/users/Show',
    ]);
  });

  it('refuses two files that resolve to the same page name', async () => {
    await expect(
      discoverPages({ ...base, cwd, glob: ['web/pages/**/*.tsx', 'minimal/pages/**/*.tsx'] }),
    ).rejects.toThrow(/"Home".*web\/pages\/Home\.tsx.*minimal\/pages\/Home\.tsx/s);
  });
});

describe('discoverPageScopes', () => {
  it('discovers every scope, prefixing its page names with "<scope>/"', async () => {
    const pages = await discoverPageScopes(
      resolveConfig(
        {
          validation: zodAdapter,
          pages: {
            glob: ['web/pages/**/*.tsx', 'shared/pages/**/*.tsx'],
            scopes: { minimal: { glob: 'minimal/pages/**/*.tsx' } },
          },
        },
        cwd,
      ),
    );
    expect(pages.map((p) => [p.scope, p.name]).sort()).toEqual([
      ['default', 'Home'],
      ['default', 'Login'],
      ['default', 'users/Show'],
      ['minimal', 'minimal/Due'],
      ['minimal', 'minimal/Home'],
    ]);
  });

  it('takes a custom prefix (or none) and a per-scope naming strategy', async () => {
    const pages = await discoverPageScopes(
      resolveConfig(
        {
          validation: zodAdapter,
          pages: {
            glob: 'web/pages/**/*.tsx',
            scopes: {
              minimal: {
                glob: 'minimal/pages/**/*.tsx',
                prefix: 'm:',
                componentNameStrategy: 'kebab',
              },
            },
          },
        },
        cwd,
      ),
    );
    expect(pages.filter((p) => p.scope === 'minimal').map((p) => p.name)).toEqual([
      'm:due',
      'm:home',
    ]);
  });

  it('refuses a page name claimed by two scopes', async () => {
    await expect(
      discoverPageScopes(
        resolveConfig(
          {
            validation: zodAdapter,
            pages: {
              glob: 'web/pages/**/*.tsx',
              scopes: { minimal: { glob: 'minimal/pages/**/*.tsx', prefix: '' } },
            },
          },
          cwd,
        ),
      ),
    ).rejects.toThrow(/"Home"/);
  });
});

describe('generate() with page scopes', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'codegen-page-scopes-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('types every scope’s pages and lists the page names of each scope', async () => {
    const config = resolveConfig(
      {
        validation: zodAdapter,
        codegen: { outDir, cwd },
        pages: {
          glob: 'web/pages/**/*.tsx',
          scopes: { minimal: { glob: 'minimal/pages/**/*.tsx' } },
        },
      },
      cwd,
    );
    await generate(config, []);
    const dts = await readFile(join(outDir, 'pages.d.ts'), 'utf8');
    expect(dts).toContain(
      'export type InertiaPageName = "Home" | "users/Show" | "minimal/Due" | "minimal/Home";',
    );
    expect(dts).toContain('"minimal/Home": Parameters<typeof import(');
    expect(dts).toMatch(
      /export interface InertiaScopePages \{\n {2}default: "Home" \| "users\/Show";\n {2}minimal: "minimal\/Due" \| "minimal\/Home";\n\}/,
    );
    expect(dts).toContain(
      'export type InertiaScopePageName<S extends keyof InertiaScopePages> = InertiaScopePages[S];',
    );
    const components = JSON.parse(await readFile(join(outDir, 'components.json'), 'utf8')) as {
      pages: Array<{ name: string; scope: string }>;
    };
    expect(components.pages.map((p) => `${p.scope}:${p.name}`)).toContain('minimal:minimal/Due');
  });
});

describe('config', () => {
  it('accepts an array of page globs and resolves scope defaults', () => {
    const config = resolveConfig(
      {
        validation: zodAdapter,
        pages: {
          glob: ['a/**/*.tsx', 'b/**/*.tsx'],
          scopes: { admin: { glob: 'admin/**/*.tsx' } },
        },
      },
      cwd,
    );
    expect(config.pages?.glob).toEqual(['a/**/*.tsx', 'b/**/*.tsx']);
    expect(config.pages?.scopes).toEqual({
      admin: { glob: 'admin/**/*.tsx', prefix: 'admin/', componentNameStrategy: 'relative-no-ext' },
    });
  });

  it('rejects a scope without a glob, and the reserved "default" scope', () => {
    expect(() =>
      resolveConfig(
        { validation: zodAdapter, pages: { glob: 'a/*.tsx', scopes: { admin: {} as never } } },
        cwd,
      ),
    ).toThrow(/pages\.scopes\.admin\.glob/);
    expect(() =>
      resolveConfig(
        {
          validation: zodAdapter,
          pages: { glob: 'a/*.tsx', scopes: { default: { glob: 'b/*.tsx' } } },
        },
        cwd,
      ),
    ).toThrow(/"default"/);
  });

  it('warns that the top-level `scopes` has no effect, pointing at pages.scopes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      resolveConfig(
        { validation: zodAdapter, scopes: { admin: { glob: 'src/admin/**/*.controller.ts' } } },
        cwd,
      );
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/`scopes`.*pages\.scopes/s));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('skip-if-unchanged manifest', () => {
  it('re-generates when a page of a scope changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codegen-page-scopes-hash-'));
    try {
      await cp(cwd, dir, { recursive: true });
      const config = resolveConfig(
        {
          validation: zodAdapter,
          codegen: { cwd: dir },
          pages: {
            glob: 'web/pages/**/*.tsx',
            scopes: { minimal: { glob: 'minimal/pages/**/*.tsx' } },
          },
        },
        dir,
      );
      const before = await computeInputsHash(config);
      await writeFile(
        join(dir, 'minimal/pages/Due.tsx'),
        'export default function Due(props: { source: string }) {\n  return props;\n}\n',
      );
      expect(await computeInputsHash(config)).not.toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
