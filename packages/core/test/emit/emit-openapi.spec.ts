import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import { buildOpenApiSpec, emitOpenApi } from '../../src/emit/emit-openapi.js';
import type { SchemaModule } from '../../src/ir/schema-node.js';

// A class-validator-style body DTO IR with: a string-email field, an enum, an
// optional number, an array of refs, and a discriminated union — plus a recursive
// named schema reachable from the array.
const createUserBody: SchemaModule = {
  root: {
    kind: 'object',
    passthrough: false,
    fields: [
      { key: 'email', value: { kind: 'string', checks: [{ check: 'email' }] } },
      { key: 'role', value: { kind: 'enum', literals: ["'admin'", "'user'"] } },
      {
        key: 'age',
        value: { kind: 'optional', inner: { kind: 'number', checks: [{ check: 'int' }] } },
      },
      { key: 'tags', value: { kind: 'array', element: { kind: 'ref', name: 'Tag' } } },
      {
        key: 'payload',
        value: {
          kind: 'union',
          discriminator: 'kind',
          options: [
            {
              kind: 'object',
              passthrough: false,
              fields: [
                { key: 'kind', value: { kind: 'literal', raw: "'text'" } },
                { key: 'text', value: { kind: 'string', checks: [] } },
              ],
            },
            {
              kind: 'object',
              passthrough: false,
              fields: [
                { key: 'kind', value: { kind: 'literal', raw: "'count'" } },
                { key: 'count', value: { kind: 'number', checks: [] } },
              ],
            },
          ],
        },
      },
    ],
  },
  named: new Map([
    [
      'Tag',
      {
        kind: 'object',
        passthrough: false,
        fields: [
          { key: 'label', value: { kind: 'string', checks: [] } },
          // Recursion: a Tag can have child Tags.
          { key: 'children', value: { kind: 'array', element: { kind: 'lazyRef', name: 'Tag' } } },
        ],
      },
    ],
  ]),
  warnings: [],
  recursive: new Set(['Tag']),
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
        error: '{ message: string }',
      },
    },
  },
  {
    method: 'POST',
    path: '/api/users',
    name: 'users.create',
    params: [],
    contract: {
      contractSource: {
        query: null,
        body: '{ email: string }',
        bodySchema: createUserBody,
        response: 'User',
      },
    },
  },
  {
    method: 'GET',
    path: '/api/events',
    name: 'events.stream',
    params: [],
    contract: {
      contractSource: {
        query: null,
        body: null,
        response: 'EventDto',
        stream: true,
      },
    },
  },
];

describe('buildOpenApiSpec', () => {
  const spec = buildOpenApiSpec(routes, { info: { title: 'Test API', version: '2.0.0' } });

  it('is a structurally valid OpenAPI 3.1 document', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toEqual({ title: 'Test API', version: '2.0.0' });
    expect(spec.paths).toBeTypeOf('object');
    expect(spec.components.schemas).toBeTypeOf('object');
  });

  it('converts :param to {param} and emits a path parameter', () => {
    expect(spec.paths['/api/users/{id}']).toBeDefined();
    const op = spec.paths['/api/users/{id}'].get as Record<string, unknown>;
    expect(op.operationId).toBe('users.show');
    const params = op.parameters as Array<Record<string, unknown>>;
    expect(params).toContainEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  });

  it('emits a request body schema for POST from the IR', () => {
    const op = spec.paths['/api/users'].post as Record<string, unknown>;
    const body = op.requestBody as { content: Record<string, { schema: Record<string, unknown> }> };
    const schema = body.content['application/json'].schema;
    expect(schema.type).toBe('object');
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.email).toEqual({ type: 'string', format: 'email' });
    expect(props.role).toEqual({ type: 'string', enum: ['admin', 'user'] });
    // optional age must NOT be in required
    expect(schema.required).toContain('email');
    expect(schema.required).not.toContain('age');
  });

  it('represents arrays + $ref + recursion in components', () => {
    expect(spec.components.schemas.Tag).toBeDefined();
    const op = spec.paths['/api/users'].post as Record<string, unknown>;
    const body = op.requestBody as { content: Record<string, { schema: Record<string, unknown> }> };
    const props = (body.content['application/json'].schema as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    expect(props.tags).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Tag' },
    });
    // recursion: Tag.children items $ref back to Tag
    const tag = spec.components.schemas.Tag;
    expect((tag.properties?.children as Record<string, unknown>).items).toEqual({
      $ref: '#/components/schemas/Tag',
    });
  });

  it('represents discriminated unions via oneOf + discriminator', () => {
    const op = spec.paths['/api/users'].post as Record<string, unknown>;
    const body = op.requestBody as { content: Record<string, { schema: Record<string, unknown> }> };
    const props = (body.content['application/json'].schema as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    expect(props.payload.oneOf).toHaveLength(2);
    expect(props.payload.discriminator).toEqual({ propertyName: 'kind' });
  });

  it('emits typed error responses', () => {
    const op = spec.paths['/api/users/{id}'].get as Record<string, unknown>;
    const responses = op.responses as Record<
      string,
      { content?: Record<string, { schema: unknown }> }
    >;
    expect(responses['400']).toBeDefined();
    expect(responses.default).toBeDefined();
    // the inline error TS type is surfaced as documentation
    const schema = responses['400'].content?.['application/json'].schema as Record<string, unknown>;
    expect(schema.description).toBe('{ message: string }');
  });

  it('marks streaming routes as text/event-stream', () => {
    const op = spec.paths['/api/events'].get as Record<string, unknown>;
    const responses = op.responses as Record<string, { content: Record<string, unknown> }>;
    expect(responses['200'].content['text/event-stream']).toBeDefined();
    expect(responses['200'].content['application/json']).toBeUndefined();
  });

  it('does not emit a request body for GET routes', () => {
    const op = spec.paths['/api/users/{id}'].get as Record<string, unknown>;
    expect(op.requestBody).toBeUndefined();
  });
});

describe('emitOpenApi', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'codegen-openapi-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes a parseable openapi.json', async () => {
    await emitOpenApi(routes, outDir, { info: { title: 'Test API', version: '2.0.0' } });
    const raw = await readFile(join(outDir, 'openapi.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.paths['/api/users']).toBeDefined();
  });
});
