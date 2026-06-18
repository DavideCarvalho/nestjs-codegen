import { describe, expect, it } from 'vitest';
import { generateMock, makeRng } from '../../src/emit/mock-gen.js';
import type { JsonSchema } from '../../src/ir/schema-node-to-json-schema.js';

describe('makeRng', () => {
  it('is deterministic for a seed', () => {
    const a = makeRng(1);
    const b = makeRng(1);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it('differs across seeds', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next());
  });
});

describe('generateMock', () => {
  it('generates a string for string schema', () => {
    expect(typeof generateMock({ type: 'string' }, makeRng(1))).toBe('string');
  });

  it('honors string formats', () => {
    expect(generateMock({ type: 'string', format: 'email' }, makeRng(1))).toMatch(/@example\.com$/);
    expect(generateMock({ type: 'string', format: 'uuid' }, makeRng(1))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('generates an integer within bounds', () => {
    const v = generateMock({ type: 'integer', minimum: 5, maximum: 7 }, makeRng(3)) as number;
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(5);
    expect(v).toBeLessThanOrEqual(7);
  });

  it('picks an enum member', () => {
    const v = generateMock({ type: 'string', enum: ['a', 'b', 'c'] }, makeRng(9));
    expect(['a', 'b', 'c']).toContain(v);
  });

  it('returns const value', () => {
    expect(generateMock({ const: 'fixed' }, makeRng(1))).toBe('fixed');
  });

  it('generates an object with all required properties of the right type', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        age: { type: 'integer' },
        active: { type: 'boolean' },
      },
      required: ['id', 'age', 'active'],
    };
    const v = generateMock(schema, makeRng(1)) as Record<string, unknown>;
    expect(typeof v.id).toBe('string');
    expect(typeof v.age).toBe('number');
    expect(typeof v.active).toBe('boolean');
  });

  it('generates a non-empty array of the item type', () => {
    const v = generateMock({ type: 'array', items: { type: 'integer' } }, makeRng(1)) as unknown[];
    expect(Array.isArray(v)).toBe(true);
    expect(v.length).toBeGreaterThan(0);
    for (const item of v) expect(typeof item).toBe('number');
  });

  it('resolves $ref via defs and terminates on recursion', () => {
    const defs: Record<string, JsonSchema> = {
      Node: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
        },
        required: ['value', 'children'],
      },
    };
    const v = generateMock({ $ref: '#/components/schemas/Node' }, makeRng(1), defs) as Record<
      string,
      unknown
    >;
    expect(typeof v.value).toBe('string');
    expect(Array.isArray(v.children)).toBe(true);
    // Must not throw / infinitely recurse.
  });

  it('picks one branch of a discriminated union (oneOf)', () => {
    const schema: JsonSchema = {
      oneOf: [
        {
          type: 'object',
          properties: { kind: { const: 'a' }, text: { type: 'string' } },
          required: ['kind', 'text'],
        },
        {
          type: 'object',
          properties: { kind: { const: 'b' }, count: { type: 'integer' } },
          required: ['kind', 'count'],
        },
      ],
      discriminator: { propertyName: 'kind' },
    };
    const v = generateMock(schema, makeRng(2)) as Record<string, unknown>;
    expect(['a', 'b']).toContain(v.kind);
  });

  it('is deterministic end-to-end for a seed', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id', 'name'],
    };
    expect(generateMock(schema, makeRng(42))).toEqual(generateMock(schema, makeRng(42)));
  });
});
