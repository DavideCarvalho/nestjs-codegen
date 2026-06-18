import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { describe, expect, it } from 'vitest';
import type { SchemaModule, SchemaNode } from '../../src/ir/schema-node.js';

function render(root: SchemaNode, named = new Map<string, SchemaNode>(), warnings: string[] = []) {
  const mod: SchemaModule = { root, named, warnings };
  return zodAdapter.renderModule(mod);
}
const obj = (fields: Array<{ key: string; value: SchemaNode }>): SchemaNode => ({
  kind: 'object',
  fields,
  passthrough: false,
});

describe('zodAdapter', () => {
  it('string with email check', () => {
    expect(
      render(obj([{ key: 'a', value: { kind: 'string', checks: [{ check: 'email' }] } }]))
        .schemaText,
    ).toBe('z.object({ a: z.string().email() })');
  });

  it('email check forwards a verbatim message', () => {
    expect(
      render(
        obj([
          {
            key: 'a',
            value: { kind: 'string', checks: [{ check: 'email', messageRaw: "'Bad'" }] },
          },
        ]),
      ).schemaText,
    ).toBe("z.object({ a: z.string().email({ message: 'Bad' }) })");
  });

  it('int number', () => {
    expect(
      render(obj([{ key: 'a', value: { kind: 'number', checks: [{ check: 'int' }] } }])).schemaText,
    ).toBe('z.object({ a: z.number().int() })');
  });

  it('date → coerce.date', () => {
    expect(render(obj([{ key: 'a', value: { kind: 'date' } }])).schemaText).toBe(
      'z.object({ a: z.coerce.date() })',
    );
  });

  it('optional wrapper', () => {
    expect(
      render(
        obj([{ key: 'a', value: { kind: 'optional', inner: { kind: 'string', checks: [] } } }]),
      ).schemaText,
    ).toBe('z.object({ a: z.string().optional() })');
  });

  it('array of strings', () => {
    expect(
      render(obj([{ key: 'a', value: { kind: 'array', element: { kind: 'string', checks: [] } } }]))
        .schemaText,
    ).toBe('z.object({ a: z.array(z.string()) })');
  });

  it('enum preserves verbatim literals', () => {
    expect(
      render(obj([{ key: 'a', value: { kind: 'enum', literals: ['"x"', '"y"'] } }])).schemaText,
    ).toBe('z.object({ a: z.enum(["x", "y"]) })');
  });

  it('empty object → passthrough', () => {
    expect(render({ kind: 'object', fields: [], passthrough: true }).schemaText).toBe(
      'z.object({}).passthrough()',
    );
  });

  it('renders hoisted named schemas', () => {
    const named = new Map<string, SchemaNode>([
      ['AddressSchema', obj([{ key: 'city', value: { kind: 'string', checks: [] } }])],
    ]);
    const out = render(
      obj([{ key: 'address', value: { kind: 'ref', name: 'AddressSchema' } }]),
      named,
    );
    expect(out.schemaText).toBe('z.object({ address: AddressSchema })');
    expect(out.namedNestedSchemas.get('AddressSchema')).toBe('z.object({ city: z.string() })');
  });

  it('importStatements only when used', () => {
    expect(zodAdapter.importStatements({ used: true })).toEqual(["import { z } from 'zod';"]);
    expect(zodAdapter.importStatements({ used: false })).toEqual([]);
  });

  it('recursive named schema → z.lazy + hoisted type alias + ZodType annotation', () => {
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
    const mod: SchemaModule = {
      root: obj([{ key: 'filter', value: { kind: 'ref', name: 'ColumnFilterSchema' } }]),
      named,
      warnings: [],
      recursive: new Set(['ColumnFilterSchema']),
    };
    const out = zodAdapter.renderModule(mod);
    expect(out.namedNestedSchemas.get('ColumnFilterSchema')).toBe(
      'z.object({ field: z.string().optional(), and: z.array(z.lazy(() => ColumnFilterSchema)).optional() })',
    );
    expect(out.namedTypeAliases?.get('ColumnFilterSchema')).toBe(
      'type ColumnFilter = { field?: string; and?: Array<ColumnFilter> }',
    );
    expect(out.namedAnnotations?.get('ColumnFilterSchema')).toBe('z.ZodType<ColumnFilter>');
  });

  it('non-recursive named schema carries no alias/annotation', () => {
    const named = new Map<string, SchemaNode>([
      ['AddressSchema', obj([{ key: 'city', value: { kind: 'string', checks: [] } }])],
    ]);
    const out = render(
      obj([{ key: 'address', value: { kind: 'ref', name: 'AddressSchema' } }]),
      named,
    );
    expect(out.namedTypeAliases?.size ?? 0).toBe(0);
    expect(out.namedAnnotations?.size ?? 0).toBe(0);
  });

  it('plain union → z.union', () => {
    const node: SchemaNode = {
      kind: 'union',
      options: [
        { kind: 'literal', raw: "'a'" },
        { kind: 'literal', raw: "'b'" },
      ],
    };
    expect(render(node).schemaText).toBe("z.union([z.literal('a'), z.literal('b')])");
  });

  it('discriminated union → z.discriminatedUnion with the tag and subtype refs', () => {
    const node: SchemaNode = {
      kind: 'union',
      discriminator: 'kind',
      options: [
        { kind: 'ref', name: 'DogSchema' },
        { kind: 'ref', name: 'CatSchema' },
      ],
    };
    expect(render(node).schemaText).toBe('z.discriminatedUnion("kind", [DogSchema, CatSchema])');
  });
});
