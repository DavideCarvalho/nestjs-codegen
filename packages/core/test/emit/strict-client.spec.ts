/**
 * The generated client under the strictest compiler settings apps commonly turn on, and
 * its request handles as real Promises.
 *
 * - `api.ts` (plain and with the TanStack layer) compiles under `noUnusedLocals`,
 *   `noUnusedParameters`, `exactOptionalPropertyTypes` and `noImplicitOverride`, so an app
 *   that type-checks the generated file does not have to loosen its own tsconfig.
 * - A leaf call (`api.items.create(input)`) is a `Promise`: it can be returned from a
 *   TanStack `mutationFn` / `queryFn`, or assigned to `Promise<T>`, without `.fetch()`.
 * - At runtime the handle is lazy (no request until awaited), memoized, and still
 *   carries its members (`fetch`, `queryKey`, `queryOptions`, …).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import { emitApi } from '../../src/emit/emit-api.js';
import { emitRoutes } from '../../src/emit/emit-routes.js';

const fixtures = fileURLToPath(new URL('../__fixtures__/strict-client/', import.meta.url));
const clientEntry = fileURLToPath(new URL('../../../client/src/index.ts', import.meta.url));

let routes: RouteDescriptor[];
let outDir: string;

beforeAll(async () => {
  routes = await discoverContractsFast({ cwd: fixtures, glob: '*.controller.ts' });
  // Inside the package, so the generated file resolves zod / @tanstack/react-query from
  // the package's node_modules the way it would in an app.
  outDir = await mkdtemp(join(fixtures, '.generated-'));
});

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

async function generate(withTanstack: boolean): Promise<string> {
  await emitRoutes(routes, outDir);
  await emitApi(routes, outDir, {
    fetcherImportPath: clientEntry,
    ...(withTanstack ? { extensions: [tanstackQuery()] } : {}),
  });
  return readFile(join(outDir, 'api.ts'), 'utf8');
}

const STRICT: ts.CompilerOptions = {
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noUncheckedIndexedAccess: true,
  noPropertyAccessFromIndexSignature: true,
  noEmit: true,
  skipLibCheck: true,
  experimentalDecorators: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  allowImportingTsExtensions: true,
};

/** Diagnostics raised by the generated files (and the usage file), not by the fixtures. */
function diagnostics(extra: string[] = []): string[] {
  const files = [join(outDir, 'api.ts'), join(outDir, 'routes.ts'), ...extra];
  const program = ts.createProgram(files, STRICT);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && files.includes(d.file.fileName))
    .map(
      (d) =>
        `${d.file?.fileName.slice(outDir.length)}:${
          d.file && d.start !== undefined
            ? d.file.getLineAndCharacterOfPosition(d.start).line + 1
            : '?'
        }: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
    );
}

describe('generated api.ts under strict compiler flags', () => {
  it('compiles without a client layer', async () => {
    await generate(false);
    expect(diagnostics()).toEqual([]);
  });

  it('compiles with the TanStack layer', async () => {
    await generate(true);
    expect(diagnostics()).toEqual([]);
  });
});

describe('request handles are Promises', () => {
  it('can be awaited, returned from mutationFn / queryFn, and typed as Promise<T>', async () => {
    await generate(true);
    const usage = join(outDir, 'usage.ts');
    await writeFile(
      usage,
      `import { mutationOptions, queryOptions, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { createFetcher } from '${clientEntry}';
import { createApi, type Route } from './api';

const api = createApi(createFetcher({ baseUrl: '/api' }));

export async function run(): Promise<string> {
  const created = await api.items.create({ body: { title: 'a' } });
  const pending: Promise<Route.Response<'items.show'>> = api.items.show({ params: { id: created.id } });
  const shown = await pending;
  const all = await Promise.all([api.items.count(), api.items.list({ query: { page: 1 } })]);
  return shown.title + String(all[0].total) + String(all[1].data.length);
}

export const create = mutationOptions({
  mutationFn: (body: Route.Body<'items.create'>) => api.items.create({ body }),
});
export const remove = mutationOptions({
  mutationFn: (id: string) => api.items.remove({ params: { id } }),
});
export const count = queryOptions({ queryKey: ['count'], queryFn: () => api.items.count() });

export function useThings() {
  const list = useQuery(api.items.list({ query: { q: 'x' } }).queryOptions());
  const pages = useInfiniteQuery(api.items.list().infiniteQueryOptions());
  const mutation = useMutation(api.items.create().mutationOptions());
  const direct = useMutation({ mutationFn: (title: string) => api.items.create({ body: { title } }) });
  return { list, pages, mutation, direct };
}
`,
      'utf8',
    );
    expect(diagnostics([usage])).toEqual([]);
  });

  it('at runtime: a lazy, memoized Promise that keeps its members', async () => {
    const source = await generate(true);
    // Run the real generated file: strip its imports and hand in stubs.
    const body = source
      .split('\n')
      .filter((l) => !l.startsWith('import '))
      .join('\n');
    const js = ts.transpileModule(body, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const calls: string[] = [];
    const fetcher = new Proxy(
      {},
      {
        get: (_t, method: string) => async (url: string) => {
          calls.push(`${method} ${url}`);
          return { url };
        },
      },
    );
    const identity = (o: unknown) => o;
    const exports: Record<string, unknown> = {};
    new Function(
      'exports',
      'route',
      '_queryOptions',
      '_infiniteQueryOptions',
      '_mutationOptions',
      js,
    )(exports, () => '', identity, identity, identity);
    const api = (exports.createApi as (f: unknown) => any)(fetcher);

    const handle = api.items.show({ params: { id: '7' } });
    expect(handle).toBeInstanceOf(Promise);
    expect(typeof handle.fetch).toBe('function');
    expect(handle.queryKey()).toEqual(['items.show', { params: { id: '7' } }]);
    handle.queryOptions();
    // Building options or reading the key sends nothing.
    expect(calls).toEqual([]);

    await expect(handle).resolves.toEqual({ url: '/items/:id' });
    await handle;
    await handle.then((r: unknown) => r);
    // Memoized: one request however many times it is awaited.
    expect(calls).toEqual(['get /items/:id']);
    // `.fetch()` still issues a fresh request.
    await handle.fetch();
    expect(calls).toHaveLength(2);

    // Rejections flow through await / catch / finally.
    const failing = new Proxy(
      {},
      {
        get: () => async () => {
          throw new Error('boom');
        },
      },
    );
    const failingApi = (exports.createApi as (f: unknown) => any)(failing);
    await expect(failingApi.items.count()).rejects.toThrow('boom');
    let finished = false;
    await failingApi.items
      .count()
      .finally(() => {
        finished = true;
      })
      .catch(() => {});
    expect(finished).toBe(true);
  });
});
