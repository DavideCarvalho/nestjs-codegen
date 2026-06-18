import { describe, expect, it } from 'vitest';
import {
  parseLiteral,
  schemaModuleToJsonSchema,
  schemaNodeToJsonSchema,
} from '../../src/ir/schema-node-to-json-schema.js';
import type { SchemaModule, SchemaNode } from '../../src/ir/schema-node.js';

describe('parseLiteral', () => {
  it('parses single- and double-quoted strings', () => {
    expect(parseLiteral("'active'")).toBe('active');
    expect(parseLiteral('"done"')).toBe('done');
  });
  it('parses numbers, booleans, null', () => {
    expect(parseLiteral('42')).toBe(42);
    expect(parseLiteral('-3.5')).toBe(-3.5);
    expect(parseLiteral('true')).toBe(true);
    expect(parseLiteral('false')).toBe(false);
    expect(parseLiteral('null')).toBeNull();
  });
});

describe('schemaNodeToJsonSchema', () => {
  it('maps primitives + string formats', () => {
    expect(schemaNodeToJsonSchema({ kind: 'string', checks: [{ check: 'email' }] })).toEqual({
      type: 'string',
      format: 'email',
    });
    expect(schemaNodeToJsonSchema({ kind: 'number', checks: [{ check: 'int' }] })).toEqual({
      type: 'integer',
    });
    expect(schemaNodeToJsonSchema({ kind: 'boolean' })).toEqual({ type: 'boolean' });
    expect(schemaNodeToJsonSchema({ kind: 'date' })).toEqual({
      type: 'string',
      format: 'date-time',
    });
  });

  it('maps number checks to numeric constraints', () => {
    expect(
      schemaNodeToJsonSchema({
        kind: 'number',
        checks: [
          { check: 'min', value: '1' },
          { check: 'max', value: '10' },
        ],
      }),
    ).toEqual({ type: 'number', minimum: 1, maximum: 10 });
  });

  it('maps string enum to typed enum array', () => {
    expect(schemaNodeToJsonSchema({ kind: 'enum', literals: ["'a'", "'b'"] })).toEqual({
      type: 'string',
      enum: ['a', 'b'],
    });
  });

  it('maps literal to const', () => {
    expect(schemaNodeToJsonSchema({ kind: 'literal', raw: "'task'" })).toEqual({
      type: 'string',
      const: 'task',
    });
  });

  it('maps array', () => {
    expect(
      schemaNodeToJsonSchema({ kind: 'array', element: { kind: 'string', checks: [] } }),
    ).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('maps object with required vs optional fields', () => {
    const node: SchemaNode = {
      kind: 'object',
      passthrough: false,
      fields: [
        { key: 'id', value: { kind: 'string', checks: [] } },
        { key: 'note', value: { kind: 'optional', inner: { kind: 'string', checks: [] } } },
      ],
    };
    const out = schemaNodeToJsonSchema(node);
    expect(out.type).toBe('object');
    expect(out.required).toEqual(['id']);
    expect(out.properties?.id).toEqual({ type: 'string' });
    expect(out.properties?.note).toEqual({ type: 'string' });
    expect(out.additionalProperties).toBe(false);
  });

  it('maps a plain union to oneOf', () => {
    const out = schemaNodeToJsonSchema({
      kind: 'union',
      options: [
        { kind: 'string', checks: [] },
        { kind: 'number', checks: [] },
      ],
    });
    expect(out.oneOf).toHaveLength(2);
    expect(out.discriminator).toBeUndefined();
  });

  it('maps a discriminated union to oneOf + discriminator', () => {
    const out = schemaNodeToJsonSchema({
      kind: 'union',
      discriminator: 'kind',
      options: [
        {
          kind: 'object',
          passthrough: false,
          fields: [{ key: 'kind', value: { kind: 'literal', raw: "'a'" } }],
        },
        {
          kind: 'object',
          passthrough: false,
          fields: [{ key: 'kind', value: { kind: 'literal', raw: "'b'" } }],
        },
      ],
    });
    expect(out.oneOf).toHaveLength(2);
    expect(out.discriminator).toEqual({ propertyName: 'kind' });
  });

  it('maps ref/lazyRef to $ref', () => {
    expect(schemaNodeToJsonSchema({ kind: 'ref', name: 'Tag' })).toEqual({
      $ref: '#/components/schemas/Tag',
    });
    expect(schemaNodeToJsonSchema({ kind: 'lazyRef', name: 'Node' })).toEqual({
      $ref: '#/components/schemas/Node',
    });
  });
});

describe('schemaModuleToJsonSchema', () => {
  it('lowers named schemas (incl. recursion) into a $ref-able map', () => {
    // A recursive tree node: { value: string; children: TreeNode[] }
    const treeNode: SchemaNode = {
      kind: 'object',
      passthrough: false,
      fields: [
        { key: 'value', value: { kind: 'string', checks: [] } },
        {
          key: 'children',
          value: { kind: 'array', element: { kind: 'lazyRef', name: 'TreeNode' } },
        },
      ],
    };
    const mod: SchemaModule = {
      root: { kind: 'ref', name: 'TreeNode' },
      named: new Map([['TreeNode', treeNode]]),
      warnings: [],
      recursive: new Set(['TreeNode']),
    };
    const { root, named } = schemaModuleToJsonSchema(mod);
    expect(root).toEqual({ $ref: '#/components/schemas/TreeNode' });
    expect(named.TreeNode.properties?.children).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/TreeNode' },
    });
  });
});
