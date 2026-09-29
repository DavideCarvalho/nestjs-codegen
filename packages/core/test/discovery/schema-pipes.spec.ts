/**
 * Request types from validation-pipe schemas, and from refined schemas generally.
 *
 * `@Body(new ZodPipe(schema))`, `@Query(new ZodPipe(schema))` and `@Param(…)` carry
 * their schema as the pipe's argument; the type checker reads it through Standard
 * Schema, so any pipe class and any schema library work, and every refinement
 * (`.email()`, `.refine()`, `.transform()`, `.default()`, …) resolves to the type it
 * refines instead of `unknown`. Request positions use the schema's INPUT type (what
 * the client may send); responses use its OUTPUT type.
 */
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverContractsFast, extractDtoContract } from '../../src/discovery/contracts-fast.js';
import { SchemaTypeProgram } from '../../src/discovery/schema-type-program.js';
import type { ContractSource, RouteDescriptor } from '../../src/discovery/types.js';

const cwd = fileURLToPath(new URL('../__fixtures__/schema-pipes/', import.meta.url));

let routes: RouteDescriptor[];
beforeAll(async () => {
  routes = await discoverContractsFast({ cwd, glob: '*.controller.ts' });
});

function contract(name: string): ContractSource {
  const route = routes.find((r) => r.name === name);
  if (!route?.contract) throw new Error(`no contracted route ${name}`);
  return route.contract.contractSource;
}

describe('zod 3 schema pipes', () => {
  it('types @Body(new ZodPipe(schema)) from the schema, resolving every refinement', () => {
    expect(contract('zod3Pipes.create').body).toBe(
      [
        '{ email: string', // .email()
        'website?: string | undefined', // .url().optional()
        'id: string', // .uuid()
        'slug: string', // .regex()
        'title: string', // .trim().min().max()
        'age: number', // .int().min().max()
        'limit?: number | undefined', // .optional().default(): may be omitted
        'nickname: string | null', // .nullable()
        'password: string', // .refine()
        'confirm: string', // .superRefine()
        'tags: string', // .transform(): the client sends what the transform READS
        'kind: "a" | "b"',
        'userId: string }', // .brand(): a plain string on the wire
      ].join('; '),
    );
  });

  it('does not read the annotation (z.infer<typeof schema>) as a DTO ref', () => {
    expect(contract('zod3Pipes.create').bodyRef ?? null).toBeNull();
    expect(contract('zod3Pipes.list').queryRef ?? null).toBeNull();
  });

  it('types a whole @Query(new ZodPipe(schema)), coerce and defaults included', () => {
    expect(contract('zod3Pipes.list').query).toBe(
      '{ search?: string | undefined; page?: number | undefined; archived?: "true" | "false" | undefined }',
    );
  });

  it('types named @Query("x", new ZodPipe(schema)) fields, optional when the schema accepts undefined', () => {
    expect(contract('zod3Pipes.search').query).toBe('{ q: string; limit?: number | undefined }');
  });

  it('types named @Param("x", new ZodPipe(schema)) path params', () => {
    expect(contract('zod3Pipes.item').paramTypes).toEqual({
      itemId: 'string',
      status: '"open" | "closed"',
    });
  });

  it('types each field of a whole @Param(new ZodPipe(objectSchema))', () => {
    expect(contract('zod3Pipes.org').paramTypes).toEqual({ org: 'string', seq: 'number' });
  });

  it('follows a schema imported from another file', () => {
    expect(contract('zod3Pipes.invite').body).toBe(
      '{ email: string; role?: "admin" | "member" | undefined }',
    );
  });

  it('reads a schema returned by a helper call (contractSchema(contract.body))', () => {
    expect(contract('zod3Pipes.note').body).toBe('{ text: string }');
  });

  it('reads a factory-style pipe (zodPipe(schema)) with an inline schema', () => {
    expect(contract('zod3Pipes.inline').body).toBe('{ ok: boolean }');
  });

  it('leaves pipes whose arguments are not schemas to the annotation', () => {
    const pages = contract('zod3Pipes.pages');
    expect(pages.query).toBe('{ size: number }');
    expect(pages.paramTypes ?? null).toBeNull();
    // `@Body(new ValidationPipe({ … })) body: Dto` reads the DTO.
    expect(contract('zod3Pipes.legacy').body).toBe('{ name: string }');
  });
});

describe('zod 4 schema pipes (zod/v4)', () => {
  it('resolves zod 4 string formats, refinements, defaults and transforms', () => {
    expect(contract('zod4Pipes.create').body).toBe(
      [
        '{ email: string', // z.email()
        'website?: string | undefined', // z.url().optional()
        'id: string', // z.uuid()
        'title: string',
        'limit?: number | undefined',
        'nickname: string | null',
        'password: string',
        'count: string }', // .transform(): input side
      ].join('; '),
    );
  });

  it('types z.coerce fields by their output (their input is `unknown`)', () => {
    expect(contract('zod4Pipes.list').query).toBe('{ page?: number; size?: number | undefined }');
  });
});

describe('library-agnostic: any Standard Schema', () => {
  it('reads a schema by its ~standard types, whatever library produced it', () => {
    expect(contract('standardSchema.rename').body).toBe(
      '{ name: string; color?: "red" | "blue" | undefined }',
    );
  });

  it('uses the input type for a request even when the output differs', () => {
    expect(contract('standardSchema.filter').query).toBe('{ from?: string | undefined }');
  });
});

describe('defineContract schemas with refinements', () => {
  it('types body/query by their input and response by their output', () => {
    const cs = contract('refinedContract.signUp');
    expect(cs.body).toBe(
      '{ email: string; password: string; plan?: "free" | "pro" | undefined; referrer: string | null }',
    );
    expect(cs.query).toBe('{ next?: string | undefined }');
    expect(cs.response).toBe('{ id: string; createdAt: Date; plan: "free" | "pro" }');
  });
});

describe('field order', () => {
  it('follows the schema source, whatever else is in the program', async () => {
    // zod 3 re-maps optional keys, and the checker orders the result by the ids of
    // the key literals — which depend on every other schema it has seen. Discovered
    // alone or next to the other fixtures, the fields come out in source order.
    const alone = await discoverContractsFast({ cwd, glob: 'zod3-pipes.controller.ts' });
    const body = alone.find((r) => r.name === 'zod3Pipes.create')?.contract?.contractSource.body;
    expect(body).toBe(contract('zod3Pipes.create').body);
    expect(body?.startsWith('{ email: string; website?: string | undefined; id: string;')).toBe(
      true,
    );
  });
});

describe('without a resolvable schema library', () => {
  it('falls back to the syntactic zod walker for a pipe argument', () => {
    // An in-memory file outside any node_modules: `zod` cannot be resolved, so the
    // checker types the schema as an error type and the walker answers instead.
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipLoadingLibFiles: true,
      skipFileDependencyResolution: true,
      compilerOptions: { strict: false },
    });
    const sf = project.createSourceFile(
      '/virtual/no-zod.controller.ts',
      `
      import { z } from 'zod';
      const body = z.object({ name: z.string(), age: z.number().optional() });
      class TestController {
        @Post()
        create(@Body(new ZodPipe(body)) dto: unknown) {}
      }
    `,
    );
    const method = sf.getClassOrThrow('TestController').getMethodOrThrow('create');
    expect(extractDtoContract(method, sf, project)?.body).toBe(
      '{ name: string; age?: number | undefined }',
    );
  });
});

describe('the typed program stays small', () => {
  it('follows only the imports a schema depends on', () => {
    const discovery = new Project({
      skipAddingFilesFromTsConfig: true,
      skipLoadingLibFiles: true,
      skipFileDependencyResolution: true,
    });
    discovery.addSourceFileAtPath(`${cwd}zod3-pipes.controller.ts`);
    const program = new SchemaTypeProgram(discovery);
    const files = program.project
      .getProgram()
      .compilerObject.getSourceFiles()
      .map((f) => f.fileName);

    // The schemas' own imports are there: zod, the schema module, the helper.
    expect(files.some((f) => f.includes('/node_modules/zod/'))).toBe(true);
    expect(files).toContain(`${cwd}schemas.ts`);
    expect(files).toContain(`${cwd}notes.service.ts`);
    // What only the rest of the code uses is not: the controller's decorators, the
    // `ZodPipe` class, and the service class `NOTE_MAX` sits next to.
    expect(files.some((f) => f.includes('@nestjs/common'))).toBe(false);
    expect(files.some((f) => f.includes('@nestjs/core'))).toBe(false);
    // …and the schema that reads `NOTE_MAX` through that pruned module still resolves.
    expect(contract('zod3Pipes.note').body).toBe('{ text: string }');
  });
});
