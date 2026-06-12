import { extractSchemaFromDto } from '@dudousxd/nestjs-codegen';
import type { SchemaModule, SchemaNode } from '@dudousxd/nestjs-codegen';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { valibotAdapter } from '../src/index.js';

function render(root: SchemaNode, named = new Map<string, SchemaNode>()): string {
  const mod: SchemaModule = { root, named, warnings: [] };
  return valibotAdapter.renderModule(mod).schemaText;
}
const obj = (fields: Array<{ key: string; value: SchemaNode }>): SchemaNode => ({
  kind: 'object',
  fields,
  passthrough: false,
});

/** End-to-end: class-validator DTO source → IR → valibot text. */
function dtoToValibot(source: string, className = 'Dto') {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const file = project.createSourceFile('dto.ts', source);
  return valibotAdapter.renderModule(
    extractSchemaFromDto(file.getClassOrThrow(className), file, project),
  );
}

describe('valibotAdapter — node rendering', () => {
  it('plain string (no checks) → v.string()', () => {
    expect(render(obj([{ key: 'a', value: { kind: 'string', checks: [] } }]))).toBe(
      'v.object({ a: v.string() })',
    );
  });

  it('string with email → v.pipe(v.string(), v.email())', () => {
    expect(
      render(obj([{ key: 'a', value: { kind: 'string', checks: [{ check: 'email' }] } }])),
    ).toBe('v.object({ a: v.pipe(v.string(), v.email()) })');
  });

  it('email message is forwarded verbatim', () => {
    expect(
      render(
        obj([
          {
            key: 'a',
            value: { kind: 'string', checks: [{ check: 'email', messageRaw: "'Bad'" }] },
          },
        ]),
      ),
    ).toBe("v.object({ a: v.pipe(v.string(), v.email('Bad')) })");
  });

  it('number int + min → v.pipe(v.number(), v.integer(), v.minValue(1))', () => {
    expect(
      render(
        obj([
          {
            key: 'a',
            value: { kind: 'number', checks: [{ check: 'int' }, { check: 'min', value: '1' }] },
          },
        ]),
      ),
    ).toBe('v.object({ a: v.pipe(v.number(), v.integer(), v.minValue(1)) })');
  });

  it('enum → v.picklist([...]) preserving verbatim literals', () => {
    expect(render(obj([{ key: 'a', value: { kind: 'enum', literals: ['"x"', '"y"'] } }]))).toBe(
      'v.object({ a: v.picklist(["x", "y"]) })',
    );
  });

  it('optional + array', () => {
    expect(
      render(
        obj([
          {
            key: 'a',
            value: {
              kind: 'optional',
              inner: { kind: 'array', element: { kind: 'string', checks: [] } },
            },
          },
        ]),
      ),
    ).toBe('v.object({ a: v.optional(v.array(v.string())) })');
  });

  it('empty passthrough object → v.looseObject({})', () => {
    expect(render({ kind: 'object', fields: [], passthrough: true })).toBe('v.looseObject({})');
  });

  it('unknown with note renders a valibot comment (not zod)', () => {
    expect(render({ kind: 'unknown', note: 'recursive type — not expanded' })).toBe(
      'v.unknown() /* recursive type — not expanded */',
    );
  });

  it('importStatements only when used', () => {
    expect(valibotAdapter.importStatements({ used: true })).toEqual([
      "import * as v from 'valibot';",
    ]);
    expect(valibotAdapter.importStatements({ used: false })).toEqual([]);
  });
});

describe('valibotAdapter — end-to-end from class-validator DTO', () => {
  it('@IsEmail @MinLength(3) → piped valibot string', () => {
    const out = dtoToValibot('class Dto { @IsEmail() @MinLength(3) a!: string; }');
    expect(out.schemaText).toBe('v.object({ a: v.pipe(v.string(), v.email(), v.minLength(3)) })');
  });

  it('nested @ValidateNested + @Type → ref + hoisted valibot named schema', () => {
    const out = dtoToValibot(
      `class Address { @IsString() city!: string; }
       class Dto { @ValidateNested() @Type(() => Address) address!: Address; }`,
    );
    expect(out.schemaText).toBe('v.object({ address: AddressSchema })');
    expect(out.namedNestedSchemas.get('AddressSchema')).toBe('v.object({ city: v.string() })');
  });

  it('recursive DTO → v.lazy + hoisted type alias + GenericSchema annotation', () => {
    const out = dtoToValibot(
      `class ColumnFilter {
         @IsString() @IsOptional() field?: string;
         @ValidateNested({ each: true }) @Type(() => ColumnFilter) @IsOptional() and?: ColumnFilter[];
       }
       class Dto { @ValidateNested() @Type(() => ColumnFilter) filter!: ColumnFilter; }`,
    );
    expect(out.namedNestedSchemas.get('ColumnFilterSchema')).toBe(
      'v.object({ field: v.optional(v.string()), and: v.optional(v.array(v.lazy(() => ColumnFilterSchema))) })',
    );
    expect(out.namedTypeAliases?.get('ColumnFilterSchema')).toBe(
      'type ColumnFilter = { field?: string; and?: Array<ColumnFilter> }',
    );
    expect(out.namedAnnotations?.get('ColumnFilterSchema')).toBe('v.GenericSchema<ColumnFilter>');
  });
});
