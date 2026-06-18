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

  it('plain T[] is detected as an array', () => {
    expect(field(ir('class Dto { @IsString() tags!: string[]; }').root, 'tags')).toEqual({
      kind: 'array',
      element: { kind: 'string', checks: [] },
    });
  });

  it('a union whose text ends in [] is NOT mistaken for an array', () => {
    // `unknown | unknown[]` ends with "[]" but is a union, not an array type.
    expect(
      field(ir('class Dto { @IsOptional() value!: unknown | unknown[]; }').root, 'value'),
    ).toEqual({ kind: 'optional', inner: { kind: 'unknown' } });
  });

  describe('recursive types', () => {
    const RECURSIVE = `
      class ColumnFilter {
        @IsString() @IsOptional() field?: string;
        @ValidateNested({ each: true }) @Type(() => ColumnFilter) @IsOptional() and?: ColumnFilter[];
      }
      class Dto {
        @ValidateNested() @Type(() => ColumnFilter) filter!: ColumnFilter;
      }`;

    it('keeps the recursive named schema as a real object (not degraded to unknown)', () => {
      const mod = ir(RECURSIVE);
      expect(field(mod.root, 'filter')).toEqual({ kind: 'ref', name: 'ColumnFilterSchema' });
      const named = mod.named.get('ColumnFilterSchema');
      expect(named?.kind).toBe('object');
    });

    it('emits a lazyRef back-edge at the recursion site', () => {
      const mod = ir(RECURSIVE);
      const named = mod.named.get('ColumnFilterSchema');
      if (named?.kind !== 'object') throw new Error('expected object');
      const and = named.fields.find((f) => f.key === 'and')?.value;
      // optional(array(lazyRef ColumnFilterSchema))
      expect(and).toEqual({
        kind: 'optional',
        inner: { kind: 'array', element: { kind: 'lazyRef', name: 'ColumnFilterSchema' } },
      });
    });

    it('reports the recursive schema name in the recursive set + a warning', () => {
      const mod = ir(RECURSIVE);
      expect([...(mod.recursive ?? [])]).toContain('ColumnFilterSchema');
      expect(mod.warnings.some((w) => w.includes('recursive'))).toBe(true);
    });

    it('degrades over-deep (non-recursive) nesting to unknown with an accurate warning', () => {
      // 9 distinct classes chained A1 -> A2 -> ... -> A9 exceeds the depth cap (8).
      const N = 10;
      const classes = Array.from({ length: N }, (_, i) => {
        const n = i + 1;
        const next =
          n < N ? `\n        @ValidateNested() @Type(() => A${n + 1}) next!: A${n + 1};` : '';
        return `class A${n} { @IsString() v!: string;${next} }`;
      }).join('\n');
      const mod = ir(
        `${classes}\n      class Dto { @ValidateNested() @Type(() => A1) a!: A1; }`,
        'Dto',
      );
      // Somewhere down the chain a node degraded to unknown for depth (not recursion).
      const serialized = JSON.stringify([...mod.named.values()]);
      expect(serialized).toContain('nesting too deep');
      expect(mod.warnings.some((w) => w.toLowerCase().includes('deep'))).toBe(true);
      // Depth degradation must NOT be reported as recursion.
      expect(mod.recursive?.size ?? 0).toBe(0);
    });
  });

  describe('discriminated unions (class-transformer @Type discriminator)', () => {
    const DISCRIMINATED = `
      class Dog { @IsString() kind!: 'dog'; @IsString() bark!: string; }
      class Cat { @IsString() kind!: 'cat'; @IsString() meow!: string; }
      class Dto {
        @ValidateNested()
        @Type(() => Object, {
          discriminator: {
            property: 'kind',
            subTypes: [
              { value: 'dog', name: Dog },
              { value: 'cat', name: Cat },
            ],
          },
        })
        animal!: Dog | Cat;
      }`;

    it('produces a discriminated union node referencing each subtype schema', () => {
      const node = field(ir(DISCRIMINATED).root, 'animal');
      expect(node.kind).toBe('union');
      if (node.kind === 'union') {
        expect(node.discriminator).toBe('kind');
        expect(node.options).toEqual([
          { kind: 'ref', name: 'DogSchema' },
          { kind: 'ref', name: 'CatSchema' },
        ]);
      }
    });

    it('hoists each subtype as a named schema', () => {
      const mod = ir(DISCRIMINATED);
      expect(mod.named.has('DogSchema')).toBe(true);
      expect(mod.named.has('CatSchema')).toBe(true);
    });

    it('wraps an array discriminated union in an array node', () => {
      const ARR = DISCRIMINATED.replace('animal!: Dog | Cat;', 'animals!: (Dog | Cat)[];').replace(
        '@ValidateNested()',
        '@ValidateNested({ each: true }) @IsArray()',
      );
      const node = field(ir(ARR).root, 'animals');
      expect(node.kind).toBe('array');
      if (node.kind === 'array') {
        expect(node.element.kind).toBe('union');
        if (node.element.kind === 'union') expect(node.element.discriminator).toBe('kind');
      }
    });
  });

  describe('generic wrapper DTOs (PaginatedDto<T>)', () => {
    const PAGINATED = `
      class Item { @IsString() id!: string; }
      class PageMeta { @IsNumber() total!: number; }
      class PaginatedDto<T> {
        @ValidateNested({ each: true }) @Type(() => Object) data!: T[];
        @ValidateNested() @Type(() => PageMeta) meta!: PageMeta;
      }
      class Dto {
        @ValidateNested() @Type(() => PaginatedDto) page!: PaginatedDto<Item>;
      }`;

    it('substitutes the type parameter so PaginatedDto<Item>.data is Array<ItemSchema>', () => {
      const mod = ir(PAGINATED);
      // The wrapper resolves to a hoisted named schema, not unknown.
      const page = field(mod.root, 'page');
      expect(page.kind).toBe('ref');
      if (page.kind !== 'ref') return;
      const wrapper = mod.named.get(page.name);
      expect(wrapper?.kind).toBe('object');
      if (wrapper?.kind !== 'object') return;
      const data = wrapper.fields.find((f) => f.key === 'data')?.value;
      // data!: T[] with T=Item → array of a ref/object to Item (NOT unknown)
      expect(data?.kind).toBe('array');
      if (data?.kind === 'array') {
        expect(JSON.stringify(data.element)).not.toContain('unknown');
      }
    });

    it('does not degrade the wrapper itself to unknown', () => {
      const mod = ir(PAGINATED);
      const serialized = JSON.stringify([...mod.named.values()]);
      // meta resolves to a real object (total: number), proving the wrapper expanded.
      expect(serialized).toContain('total');
    });
  });
});
