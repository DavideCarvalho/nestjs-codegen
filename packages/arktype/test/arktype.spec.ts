import { extractSchemaFromDto } from '@dudousxd/nestjs-codegen';
import type { SchemaModule, SchemaNode } from '@dudousxd/nestjs-codegen';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { arktypeAdapter } from '../src/index.js';

function render(root: SchemaNode, named = new Map<string, SchemaNode>()): string {
  const mod: SchemaModule = { root, named, warnings: [] };
  return arktypeAdapter.renderModule(mod).schemaText;
}
const obj = (fields: Array<{ key: string; value: SchemaNode }>): SchemaNode => ({
  kind: 'object',
  fields,
  passthrough: false,
});

function dtoToArktype(source: string, className = 'Dto') {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const file = project.createSourceFile('dto.ts', source);
  return arktypeAdapter.renderModule(
    extractSchemaFromDto(file.getClassOrThrow(className), file, project),
  );
}

describe('arktypeAdapter — node rendering', () => {
  it('root object wrapped in type(); string keyword', () => {
    expect(render(obj([{ key: 'a', value: { kind: 'string', checks: [] } }]))).toBe(
      'type({ a: "string" })',
    );
  });

  it('string.email with min length range', () => {
    expect(
      render(
        obj([
          {
            key: 'a',
            value: { kind: 'string', checks: [{ check: 'email' }, { check: 'min', value: '3' }] },
          },
        ]),
      ),
    ).toBe('type({ a: "string.email >= 3" })');
  });

  it('number.integer with min', () => {
    expect(
      render(
        obj([
          {
            key: 'a',
            value: { kind: 'number', checks: [{ check: 'int' }, { check: 'min', value: '1' }] },
          },
        ]),
      ),
    ).toBe('type({ a: "number.integer >= 1" })');
  });

  it('optional value → optional KEY (arktype style)', () => {
    expect(
      render(
        obj([{ key: 'a', value: { kind: 'optional', inner: { kind: 'string', checks: [] } } }]),
      ),
    ).toBe('type({ "a?": "string" })');
  });

  it('enum → single-quoted DSL union', () => {
    expect(render(obj([{ key: 'a', value: { kind: 'enum', literals: ['"x"', '"y"'] } }]))).toBe(
      `type({ a: "'x' | 'y'" })`,
    );
  });

  it('array of scalar → "string[]"', () => {
    expect(
      render(
        obj([{ key: 'a', value: { kind: 'array', element: { kind: 'string', checks: [] } } }]),
      ),
    ).toBe('type({ a: "string[]" })');
  });

  it('importStatements only when used', () => {
    expect(arktypeAdapter.importStatements({ used: true })).toEqual([
      "import { type } from 'arktype';",
    ]);
    expect(arktypeAdapter.importStatements({ used: false })).toEqual([]);
  });
});

describe('arktypeAdapter — end-to-end from class-validator DTO', () => {
  it('@IsEmail @MinLength(3) → arktype string range', () => {
    expect(dtoToArktype('class Dto { @IsEmail() @MinLength(3) a!: string; }').schemaText).toBe(
      'type({ a: "string.email >= 3" })',
    );
  });

  it('nested @ValidateNested + @Type → ref + hoisted arktype named schema', () => {
    const out = dtoToArktype(
      `class Address { @IsString() city!: string; }
       class Dto { @ValidateNested() @Type(() => Address) address!: Address; }`,
    );
    expect(out.schemaText).toBe('type({ address: AddressSchema })');
    expect(out.namedNestedSchemas.get('AddressSchema')).toBe('type({ city: "string" })');
  });

  it('@IsOptional → optional arktype key end-to-end', () => {
    expect(
      dtoToArktype('class Dto { @IsString() @IsOptional() nickname?: string; }').schemaText,
    ).toBe('type({ "nickname?": "string" })');
  });
});
