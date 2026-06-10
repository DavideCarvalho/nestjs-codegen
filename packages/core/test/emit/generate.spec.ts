import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractSchemaFromDto } from '../../src/discovery/dto-to-ir.js';
import type { RouteDescriptor } from '../../src/discovery/route-model.js';
import { generate } from '../../src/generate.js';
import type { SchemaModule } from '../../src/ir/schema-node.js';

function bodySchema(source: string): SchemaModule {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const file = project.createSourceFile('dto.ts', source);
  return extractSchemaFromDto(file.getClassOrThrow('Dto'), file, project);
}

describe('generate', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestjs-codegen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes routes.ts + api.ts, and forms.ts using the zod adapter', async () => {
    const routes: RouteDescriptor[] = [
      {
        name: 'auth.login',
        method: 'POST',
        path: '/auth/login',
        contract: {
          responseType: 'User',
          bodyType: 'LoginDto',
          body: bodySchema(
            'class Dto { @IsEmail() email!: string; @MinLength(8) password!: string; }',
          ),
        },
      },
      { name: 'users.list', method: 'GET', path: '/users', contract: { responseType: 'User[]' } },
    ];

    const result = await generate(routes, { outDir: dir, query: true, validation: 'zod' });
    expect(result).toEqual({ routes: 2, forms: true });

    const routesTs = await readFile(join(dir, 'routes.ts'), 'utf8');
    expect(routesTs).toContain('"auth.login": "/auth/login"');

    const apiTs = await readFile(join(dir, 'api.ts'), 'utf8');
    expect(apiTs).toContain(
      "import { mutationOptions, queryOptions } from '@tanstack/query-core';",
    );
    expect(apiTs).toContain('login:');

    const formsTs = await readFile(join(dir, 'forms.ts'), 'utf8');
    expect(formsTs).toContain("import { z } from 'zod';");
    expect(formsTs).toContain(
      'export const AuthLoginBodySchema = z.object({ email: z.string().email(), password: z.string().min(8) });',
    );
    expect(formsTs).toContain('"auth.login": { body: AuthLoginBodySchema }');
  });

  it('skips forms.ts when no contract has a schema', async () => {
    const result = await generate([{ name: 'users.list', method: 'GET', path: '/users' }], {
      outDir: dir,
    });
    expect(result.forms).toBe(false);
  });
});
