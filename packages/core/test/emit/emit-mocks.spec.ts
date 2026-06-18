import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import { buildMocksFile, emitMocks } from '../../src/emit/emit-mocks.js';
import { MOCK_GEN_RUNTIME } from '../../src/emit/mock-gen-runtime.js';
import { generateMock, makeRng } from '../../src/emit/mock-gen.js';
import { schemaModuleToJsonSchema } from '../../src/ir/schema-node-to-json-schema.js';
import type { SchemaModule } from '../../src/ir/schema-node.js';

const userResponse: SchemaModule = {
  root: {
    kind: 'object',
    passthrough: false,
    fields: [
      { key: 'id', value: { kind: 'string', checks: [{ check: 'uuid' }] } },
      { key: 'email', value: { kind: 'string', checks: [{ check: 'email' }] } },
      { key: 'age', value: { kind: 'number', checks: [{ check: 'int' }] } },
      { key: 'role', value: { kind: 'enum', literals: ["'admin'", "'user'"] } },
    ],
  },
  named: new Map(),
  warnings: [],
};

const routes: RouteDescriptor[] = [
  {
    method: 'GET',
    path: '/api/users/:id',
    name: 'users.show',
    params: [{ name: 'id', source: 'path' }],
    contract: {
      contractSource: {
        query: null,
        body: null,
        response: 'User',
        responseSchema: userResponse,
      },
    },
  },
  {
    method: 'POST',
    path: '/api/users',
    name: 'users.create',
    params: [],
    contract: { contractSource: { query: null, body: '{ email: string }', response: 'User' } },
  },
  {
    method: 'GET',
    path: '/api/events',
    name: 'events.stream',
    params: [],
    contract: { contractSource: { query: null, body: null, response: 'EventDto', stream: true } },
  },
];

describe('buildMocksFile', () => {
  it('emits a handler per contracted route', async () => {
    const src = buildMocksFile(routes, { seed: 7 });
    expect(src).toContain('http.get("/api/users/:id"');
    expect(src).toContain('http.post("/api/users"');
    expect(src).toContain('http.get("/api/events"');
    // one handler comment per route
    expect(src).toContain('// users.show');
    expect(src).toContain('// users.create');
    expect(src).toContain('// events.stream (stream)');
  });

  it('imports from msw and exports a handlers array', () => {
    const src = buildMocksFile(routes, {});
    expect(src).toContain("import { http, HttpResponse } from 'msw'");
    expect(src).toContain('export const handlers = [');
  });

  it('embeds the generator runtime (no faker dependency)', () => {
    const src = buildMocksFile(routes, {});
    expect(src).toContain('function makeRng');
    expect(src).toContain('function generateMock');
    // no faker IMPORT (the header comment mentions faker only to explain why).
    expect(src).not.toContain("from '@faker-js");
    expect(src).not.toContain('require("@faker-js');
  });

  it('uses the configured seed and baseUrl', () => {
    const src = buildMocksFile(routes, { seed: 99, baseUrl: 'http://x' });
    expect(src).toContain('const SEED = 99;');
    expect(src).toContain('http.get("http://x/api/users/:id"');
  });

  it('embeds response schemas + DEFS and streaming uses text/event-stream', () => {
    const src = buildMocksFile(routes, {});
    // the response IR schema is inlined into the handler
    expect(src).toContain('"format":"uuid"');
    expect(src).toContain('"format":"email"');
    expect(src).toContain("'Content-Type': 'text/event-stream'");
  });
});

describe('embedded runtime == tested runtime', () => {
  it('the embedded runtime string produces identical output to the imported generateMock', () => {
    // Evaluate the SAME string the emitter inlines, then compare to the typed
    // wrapper the unit tests use — they must be byte-identical behavior.
    const factory = new Function(
      `${MOCK_GEN_RUNTIME}\nreturn { makeRng, generateMock };`,
    ) as () => {
      makeRng: (seed: number) => { next(): number };
      generateMock: (s: unknown, r: { next(): number }, d?: unknown) => unknown;
    };
    const embedded = factory();
    const schema = {
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'string' } },
    };
    expect(embedded.generateMock(schema, embedded.makeRng(7))).toEqual(
      generateMock(schema as never, makeRng(7)),
    );
  });
});

describe('emitMocks (mock data conformance + determinism)', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'codegen-mocks-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes mocks.ts containing the runtime + handlers', async () => {
    await emitMocks(routes, outDir, { seed: 1 });
    const src = await readFile(join(outDir, 'mocks.ts'), 'utf8');
    expect(src).toContain('function generateMock');
    expect(src).toContain('export const handlers = [');
  });

  it('emits syntactically valid TypeScript (no parse/syntax errors)', async () => {
    await emitMocks(routes, outDir, { seed: 1 });
    const src = await readFile(join(outDir, 'mocks.ts'), 'utf8');
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('mocks.ts', src);
    // Syntax-only diagnostics from the parser (module resolution is excluded).
    const program = project.getProgram().compilerObject;
    const sourceFile = program.getSourceFile('mocks.ts');
    const syntaxErrors = program.getSyntacticDiagnostics(sourceFile);
    expect(syntaxErrors).toHaveLength(0);
  });

  it('generated mock data conforms to the response schema shape (via the same runtime)', () => {
    // The emitted file embeds the SAME generator the unit test imports, so we
    // validate conformance by running that generator on the response schema.
    const { root } = schemaModuleToJsonSchema(userResponse);
    const value = generateMock(root, makeRng(1)) as Record<string, unknown>;
    expect(typeof value.id).toBe('string');
    expect(value.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(value.email).toMatch(/@example\.com$/);
    expect(typeof value.age).toBe('number');
    expect(Number.isInteger(value.age)).toBe(true);
    expect(['admin', 'user']).toContain(value.role);
  });

  it('is deterministic for a seed', async () => {
    const a = buildMocksFile(routes, { seed: 5 });
    const b = buildMocksFile(routes, { seed: 5 });
    expect(a).toBe(b);
  });
});
