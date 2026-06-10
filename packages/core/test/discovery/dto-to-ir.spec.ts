import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractSchemaFromDto } from '../../src/discovery/dto-to-ir.js';
import type { SchemaNode } from '../../src/ir/schema-node.js';

function ir(source: string, className = 'Dto') {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const file = project.createSourceFile('dto.ts', source);
  return extractSchemaFromDto(file.getClassOrThrow(className), file, project);
}
function field(root: SchemaNode, key: string): SchemaNode {
  if (root.kind !== 'object') throw new Error('not an object');
  const f = root.fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f.value;
}

describe('extractSchemaFromDto', () => {
  it('@IsEmail → string with email check', () => {
    expect(field(ir('class Dto { @IsEmail() a!: string; }').root, 'a')).toEqual({
      kind: 'string',
      checks: [{ check: 'email' }],
    });
  });

  it('@IsInt → number with int check', () => {
    expect(field(ir('class Dto { @IsInt() a!: number; }').root, 'a')).toEqual({
      kind: 'number',
      checks: [{ check: 'int' }],
    });
  });

  it('@IsOptional wraps in optional', () => {
    expect(field(ir('class Dto { @IsString() @IsOptional() a?: string; }').root, 'a')).toEqual({
      kind: 'optional',
      inner: { kind: 'string', checks: [] },
    });
  });

  it('@IsEnum resolves to an enum node with verbatim members', () => {
    const node = field(ir("enum E { A = 'a', B = 'b' } class Dto { @IsEnum(E) a!: E; }").root, 'a');
    expect(node.kind).toBe('enum');
    if (node.kind === 'enum') expect(node.literals).toEqual(['"a"', '"b"']);
  });

  it('@ValidateNested + @Type → ref node + hoisted named schema', () => {
    const mod = ir(
      `class Address { @IsString() city!: string; }
       class Dto { @ValidateNested() @Type(() => Address) address!: Address; }`,
    );
    expect(field(mod.root, 'address')).toEqual({ kind: 'ref', name: 'AddressSchema' });
    expect(mod.named.has('AddressSchema')).toBe(true);
  });

  it('unmappable decorator → annotated node + warning', () => {
    const mod = ir('class Dto { @IsString() @IsStrongPassword() a!: string; }');
    const node = field(mod.root, 'a');
    expect(node.kind).toBe('annotated');
    if (node.kind === 'annotated') expect(node.unmappable).toContain('IsStrongPassword');
    expect(mod.warnings.some((w) => w.includes('IsStrongPassword'))).toBe(true);
  });
});
