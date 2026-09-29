/**
 * End to end over the schema-pipes fixture: discover → emit routes.ts + api.ts →
 * type-check the generated client against the REAL `Fetcher` of
 * @dudousxd/nestjs-client.
 *
 * - `@Head()` / `@Options()` routes call `fetcher.head` / `fetcher.options`, which the
 *   client provides.
 * - An `@All()` route gets no client method (it answers every verb, so there is no
 *   one request to type) but keeps its `routes.ts` entry for hand-written calls.
 * - Schema-pipe routes carry their schema-derived body/query/params types.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import { emitApi } from '../../src/emit/emit-api.js';
import { buildOpenApiSpec } from '../../src/emit/emit-openapi.js';
import { emitRoutes } from '../../src/emit/emit-routes.js';

const fixtures = fileURLToPath(new URL('../__fixtures__/schema-pipes/', import.meta.url));
const clientEntry = fileURLToPath(new URL('../../../client/src/index.ts', import.meta.url));

let routes: RouteDescriptor[];
let outDir: string;

beforeAll(async () => {
  routes = await discoverContractsFast({ cwd: fixtures, glob: '*.controller.ts' });
  // Inside the package, so the generated file resolves zod / @tanstack/react-query
  // from the package's node_modules the way it would in an app.
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

/** Diagnostics the generated files themselves raise (the fixtures' own are not the subject). */
function generatedDiagnostics(): string[] {
  const files = [join(outDir, 'api.ts'), join(outDir, 'routes.ts')];
  const program = ts.createProgram(files, {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    experimentalDecorators: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    allowImportingTsExtensions: true,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && files.includes(d.file.fileName))
    .map((d) => `${d.file?.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

describe('@All / @Head / @Options routes', () => {
  it('emits fetcher.head / fetcher.options, and no client method for @All', async () => {
    const api = await generate(false);
    expect(api).toContain('fetcher.head<');
    expect(api).toContain('fetcher.options<');
    expect(api).not.toContain('fetcher.all');
    expect(api).not.toMatch(/\bmcp\b/);
    // The rest of the controller is unaffected.
    expect(api).toContain('status: (input?:');
  });

  it('keeps the @All route in routes.ts so its URL can still be built', async () => {
    await generate(false);
    const routesTs = await readFile(join(outDir, 'routes.ts'), 'utf8');
    expect(routesTs).toContain('"protocol.mcp": "/protocol/mcp"');
  });

  it('leaves the @All route out of the OpenAPI document (it has no single operation)', () => {
    const spec = buildOpenApiSpec(routes);
    expect(spec.paths['/protocol/mcp']).toBeUndefined();
    expect(spec.paths['/protocol/uploads/{id}']?.head).toBeDefined();
  });

  it('the generated client type-checks against the real Fetcher', async () => {
    await generate(false);
    expect(generatedDiagnostics()).toEqual([]);
  });

  it('…and with the TanStack layer', async () => {
    await generate(true);
    expect(generatedDiagnostics()).toEqual([]);
  });
});

describe('schema-pipe routes in the generated client', () => {
  it('carries schema-typed body, query and path params', async () => {
    const api = await generate(false);
    expect(api).toMatch(
      /item: \{ method: "GET"; url: "\/zod3\/items\/:itemId\/:status"; params: \{ itemId: string; status: "open" \| "closed" \};/,
    );
    expect(api).toContain('params: { org: string; seq: number }');
    expect(api).toContain('body: { text: string };');
    expect(api).toContain('query: { q: string; limit?: number | undefined };');
  });
});
