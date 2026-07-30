import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';
import type { RouteDescriptor } from '../../src/discovery/types.js';

/**
 * Discovery resolves a factory-based controller's heritage through the type
 * checker (go-to-definition), which is the ONE part of discovery that needs the
 * consumer's `paths` mapping — the DTO/type side has its own hand-rolled alias
 * resolver. So a Project built without the tsconfig loses exactly the
 * factory-derived controllers, and nothing else: every route those controllers
 * would have contributed disappears from the generated client with no error.
 */

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const FACTORY = `import { Post } from '@nestjs/common';

export class Widget {
  id!: string;
}

export function createTableController<E extends object>(_entity: new () => E) {
  class GeneratedTableController {
    @Post('search')
    search(): { data: E[] } {
      return { data: [] };
    }
  }
  return GeneratedTableController;
}
`;

const DTO = `export class WidgetDto {
  id!: string;
}
`;

/**
 * Reaches BOTH alias-resolving paths through `@/*`: the factory heritage, which
 * resolves through the type checker (the Project's compiler options), and the
 * response DTO, which resolves through discovery's own module-specifier
 * resolution (the context's `paths` + their base directory). The two used to read
 * the tsconfig separately and could disagree.
 */
const CONTROLLER = `import { Controller, Get } from '@nestjs/common';
import { Widget, createTableController } from '@/table-factory';
import { WidgetDto } from '@/widget.dto';

@Controller('widgets')
export class WidgetsController extends createTableController(Widget) {
  @Get('one')
  one(): WidgetDto {
    return new WidgetDto();
  }
}
`;

/** Same controller, reaching everything relatively — needs no `paths` at all. */
const CONTROLLER_RELATIVE = CONTROLLER.replaceAll("from '@/", "from './");

/** A tsconfig with `paths` and deliberately NO `include`, like a Nest app's. */
const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'commonjs',
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    baseUrl: './',
    paths: { '@/*': ['./src/*'] },
  },
};

const roots: string[] = [];

/** `tsconfig`: an object to serialize, raw text to write verbatim, or null for none. */
async function scaffold(tsconfig: unknown, controller = CONTROLLER): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codegen-discovery-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'table-factory.ts'), FACTORY, 'utf8');
  await writeFile(join(root, 'src', 'widget.dto.ts'), DTO, 'utf8');
  await writeFile(join(root, 'src', 'widgets.controller.ts'), controller, 'utf8');
  if (tsconfig !== null) {
    const text = typeof tsconfig === 'string' ? tsconfig : JSON.stringify(tsconfig, null, 2);
    await writeFile(join(root, 'tsconfig.json'), text, 'utf8');
  }
  return root;
}

/**
 * A directory the codegen process cannot read — the shape a docker bind mount
 * takes once a container chowns it to its own UID with mode-700 subdirs
 * (Grafana, Prometheus, MinIO, a DB data dir).
 */
async function addUnreadableDir(root: string): Promise<void> {
  const sub = join(root, 'unreadable', 'sub');
  await mkdir(sub, { recursive: true });
  await chmod(sub, 0o000);
}

/**
 * Both alias-resolving paths worked: the factory heritage produced its route, and
 * the DTO ref resolved to a real file rather than being left as the bare `@/...`
 * specifier (which is what an unresolved alias degrades to).
 */
function expectFullyResolved(routes: RouteDescriptor[], root: string, context = ''): void {
  expect(routes.map((r) => `${r.method} ${r.path}`).sort(), context).toEqual([
    'GET /widgets/one',
    'POST /widgets/search',
  ]);
  const one = routes.find((r) => r.path === '/widgets/one');
  expect(one?.contract?.contractSource.responseRef, context).toEqual({
    name: 'WidgetDto',
    filePath: join(root, 'src', 'widget.dto.ts'),
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    // Restore traversal before rm, or the cleanup trips over the same EACCES.
    await chmod(join(root, 'unreadable', 'sub'), 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

describe('discovery Project construction from the consumer tsconfig', () => {
  it('resolves alias-imported factories and DTOs through the tsconfig paths', async () => {
    const root = await scaffold(TSCONFIG);

    const routes = await discoverContractsFast({ cwd: root, glob: 'src/**/*.controller.ts' });

    expectFullyResolved(routes, root);
  });

  it.skipIf(isRoot)(
    'still resolves them when a directory under the project root is unreadable',
    async () => {
      const root = await scaffold(TSCONFIG);
      await addUnreadableDir(root);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const routes = await discoverContractsFast({ cwd: root, glob: 'src/**/*.controller.ts' });

      // The tsconfig has no `include`, so loading it used to enumerate the whole
      // project root, throw EACCES, and silently drop to a Project with no
      // `paths` — taking every factory-derived controller down with it.
      expectFullyResolved(
        routes,
        root,
        `warnings: ${warn.mock.calls.map((c) => String(c[0])).join(' | ')}`,
      );
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('warns naming the tsconfig when a tsconfig exists but cannot be loaded', async () => {
    const root = await scaffold('{ this is not valid json }');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await discoverContractsFast({ cwd: root, glob: 'src/**/*.controller.ts' });

    const messages = warn.mock.calls.map((c) => String(c[0]));
    const message = messages.find((m) => m.includes(join(root, 'tsconfig.json')));
    expect(message, `got: ${messages.join(' | ')}`).toBeDefined();
    // The cost, not just the cause: the per-controller warning that follows
    // blames the controller, so this line has to carry the real explanation.
    expect(message).toMatch(/path alias/i);
  });

  it('resolves aliases declared in an extended base tsconfig', async () => {
    const root = await scaffold({ extends: './config/base.json' });
    await mkdir(join(root, 'config'), { recursive: true });
    // `baseUrl` points back at the project root from inside `config/`, the usual
    // shape when a monorepo keeps its base tsconfig in a subdirectory.
    await writeFile(
      join(root, 'config', 'base.json'),
      JSON.stringify({
        compilerOptions: { ...TSCONFIG.compilerOptions, baseUrl: '..' },
      }),
      'utf8',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const routes = await discoverContractsFast({ cwd: root, glob: 'src/**/*.controller.ts' });

    expectFullyResolved(
      routes,
      root,
      `warnings: ${warn.mock.calls.map((c) => String(c[0])).join(' | ')}`,
    );
  });

  it('resolves aliases inherited with no baseUrl, relative to the file declaring them', async () => {
    // No `baseUrl` anywhere, so the mappings resolve against the directory of the
    // file that DECLARED them (TypeScript's `pathsBasePath`) — `config/`, not the
    // project root. Hence `../src/*`.
    const root = await scaffold({ extends: './config/base.json' });
    await mkdir(join(root, 'config'), { recursive: true });
    await writeFile(
      join(root, 'config', 'base.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['../src/*'] } } }),
      'utf8',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const routes = await discoverContractsFast({ cwd: root, glob: 'src/**/*.controller.ts' });

    expectFullyResolved(
      routes,
      root,
      `warnings: ${warn.mock.calls.map((c) => String(c[0])).join(' | ')}`,
    );
  });

  it('stays silent when the consumer simply has no tsconfig', async () => {
    const root = await scaffold(null, CONTROLLER_RELATIVE);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Relative imports need no `paths`, so a tsconfig-less consumer is a
    // supported setup, not a misconfiguration — warning here would fire on
    // working code. (The repo's own fixtures are exactly this shape.)
    const routes = await discoverContractsFast({ cwd: root, glob: 'src/**/*.controller.ts' });

    expectFullyResolved(routes, root);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
  });
});
