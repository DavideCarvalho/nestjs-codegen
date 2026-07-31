import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PersistentDiscovery,
  discoverContractsFast,
  extractAllRoutes,
} from '../../src/discovery/contracts-fast.js';

/**
 * Route order decides the order of everything emitted from it — the groups in
 * `api.ts`, the entries in `routes.ts`. It used to be whatever order discovery
 * happened to reach the files in: `fast-glob`'s directory walk on the cold path
 * (I/O-completion order from a concurrent walk, so it can differ between a cold
 * and a warm FS cache), and append-on-create in the watcher. Both let an
 * untouched source tree regenerate a client that differs by a moved block.
 */

const CONTROLLER = (
  name: string,
  path: string,
) => `import { Controller, Get } from '@nestjs/common';

@Controller('${path}')
export class ${name}Controller {
  @Get()
  list(): { ok: boolean } {
    return { ok: true };
  }
}
`;

/** Nested so a directory walk can plausibly interleave them any which way. */
const FIXTURES = [
  ['src/zulu/alpha.controller.ts', 'Alpha', 'alpha'],
  ['src/alpha/zulu.controller.ts', 'Zulu', 'zulu'],
  ['src/mike.controller.ts', 'Mike', 'mike'],
  ['src/alpha/nested/bravo.controller.ts', 'Bravo', 'bravo'],
] as const;

/**
 * The routes ordered by their FILE path — deliberately not the order of the
 * route paths themselves, so a sort of the wrong thing cannot pass:
 * `src/alpha/nested/bravo` < `src/alpha/zulu` < `src/mike` < `src/zulu/alpha`.
 */
const EXPECTED = ['/bravo', '/zulu', '/mike', '/alpha'];

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function scaffold(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codegen-route-order-'));
  roots.push(root);
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }), 'utf8');
  for (const [rel, name, path] of FIXTURES) {
    const abs = join(root, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, CONTROLLER(name, path), 'utf8');
  }
  return root;
}

const OPTS = (cwd: string) => ({ cwd, glob: 'src/**/*.controller.ts' });

describe('route order', () => {
  it('is sorted by file path, not by the order the glob walked them', async () => {
    const root = await scaffold();
    const routes = await discoverContractsFast(OPTS(root));

    expect(routes.map((r) => r.path)).toEqual(EXPECTED);
  });

  it('does not depend on the order files were added to the Project', async () => {
    const root = await scaffold();
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipLoadingLibFiles: true,
      skipFileDependencyResolution: true,
    });
    // Reverse of sorted: the worst case a walk could hand us.
    for (const [rel] of [...FIXTURES].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
      project.addSourceFileAtPath(join(root, rel));
    }

    expect(extractAllRoutes(project).map((r) => r.path)).toEqual(EXPECTED);
  });

  it('puts a controller added mid-watch where a cold run would, not at the end', async () => {
    const root = await scaffold();
    const session = await PersistentDiscovery.create(OPTS(root));
    session.discover();

    // Sorts FIRST, so appending it would be visible immediately.
    const added = join(root, 'src', 'aaa.controller.ts');
    await writeFile(added, CONTROLLER('Aaa', 'aaa'), 'utf8');
    const watched = await session.rediscover([added]);

    expect(watched.map((r) => r.path)).toEqual(['/aaa', ...EXPECTED]);
    // The claim the persistent path makes about itself: same output as a cold run.
    const cold = await discoverContractsFast(OPTS(root));
    expect(watched.map((r) => r.path)).toEqual(cold.map((r) => r.path));
  });
});
