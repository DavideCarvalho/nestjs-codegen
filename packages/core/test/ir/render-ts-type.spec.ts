import { describe, expect, it } from 'vitest';
import { type TsTypeContext, renderTsType } from '../../src/ir/render-ts-type.js';
import type { SchemaNode } from '../../src/ir/schema-node.js';

function ctx(
  named: Map<string, SchemaNode> = new Map(),
  recursive: Set<string> = new Set(),
): TsTypeContext {
  return {
    named,
    recursive,
    typeNameFor: (schemaName) => schemaName.replace(/Schema$/, ''),
  };
}

const obj = (fields: Array<{ key: string; value: SchemaNode }>): SchemaNode => ({
  kind: 'object',
  fields,
  passthrough: false,
});

describe('renderTsType', () => {
  it('maps scalars', () => {
    expect(renderTsType({ kind: 'string', checks: [] }, ctx())).toBe('string');
    expect(renderTsType({ kind: 'number', checks: [] }, ctx())).toBe('number');
    expect(renderTsType({ kind: 'boolean' }, ctx())).toBe('boolean');
    expect(renderTsType({ kind: 'date' }, ctx())).toBe('Date');
    expect(renderTsType({ kind: 'unknown' }, ctx())).toBe('unknown');
    expect(renderTsType({ kind: 'instanceof', ctor: 'File' }, ctx())).toBe('File');
  });

  it('maps enum + literal + union to literal type unions', () => {
    expect(renderTsType({ kind: 'enum', literals: ['"a"', '"b"'] }, ctx())).toBe('"a" | "b"');
    expect(renderTsType({ kind: 'literal', raw: '"x"' }, ctx())).toBe('"x"');
    expect(
      renderTsType(
        { kind: 'union', options: [{ kind: 'literal', raw: '1' }, { kind: 'boolean' }] },
        ctx(),
      ),
    ).toBe('1 | boolean');
  });

  it('object renders optional keys with `?` and quotes invalid identifiers', () => {
    const node = obj([
      { key: 'field', value: { kind: 'optional', inner: { kind: 'string', checks: [] } } },
      { key: 'n', value: { kind: 'number', checks: [] } },
      { key: 'weird-key', value: { kind: 'boolean' } },
    ]);
    expect(renderTsType(node, ctx())).toBe('{ field?: string; n: number; "weird-key": boolean }');
  });

  it('array renders Array<...>', () => {
    expect(renderTsType({ kind: 'array', element: { kind: 'string', checks: [] } }, ctx())).toBe(
      'Array<string>',
    );
  });

  it('inlines a non-recursive ref', () => {
    const named = new Map<string, SchemaNode>([
      ['AddressSchema', obj([{ key: 'city', value: { kind: 'string', checks: [] } }])],
    ]);
    expect(renderTsType({ kind: 'ref', name: 'AddressSchema' }, ctx(named))).toBe(
      '{ city: string }',
    );
  });

  it('uses the type-alias name for a recursive ref/lazyRef (no infinite inline)', () => {
    const named = new Map<string, SchemaNode>([
      [
        'ColumnFilterSchema',
        obj([
          { key: 'field', value: { kind: 'optional', inner: { kind: 'string', checks: [] } } },
          {
            key: 'and',
            value: {
              kind: 'optional',
              inner: { kind: 'array', element: { kind: 'lazyRef', name: 'ColumnFilterSchema' } },
            },
          },
        ]),
      ],
    ]);
    const c = ctx(named, new Set(['ColumnFilterSchema']));
    expect(renderTsType(named.get('ColumnFilterSchema')!, c)).toBe(
      '{ field?: string; and?: Array<ColumnFilter> }',
    );
    expect(renderTsType({ kind: 'lazyRef', name: 'ColumnFilterSchema' }, c)).toBe('ColumnFilter');
  });
});
