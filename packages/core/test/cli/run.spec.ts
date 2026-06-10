import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCodegen } from '../../src/cli/run.js';

describe('runCodegen (end-to-end: discover controllers → emit)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestjs-codegen-cli-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('discovers a controller file and generates routes/api/forms', async () => {
    const controller = join(dir, 'users.controller.ts');
    await writeFile(
      controller,
      `class CreateUserDto { @IsEmail() email!: string; }
       @Controller('users')
       class UsersController {
         @Get() list(): Promise<User[]> { return null as any; }
         @Post() create(@Body() dto: CreateUserDto): Promise<User> { return null as any; }
       }`,
      'utf8',
    );
    const out = join(dir, 'generated');

    const result = await runCodegen({
      controllers: [controller],
      outDir: out,
      query: true,
      validation: 'zod',
    });
    expect(result).toEqual({ routes: 2, forms: true });

    const routesTs = await readFile(join(out, 'routes.ts'), 'utf8');
    expect(routesTs).toContain('"users.list": "/users"');
    expect(routesTs).toContain('"users.create": "/users"');

    const apiTs = await readFile(join(out, 'api.ts'), 'utf8');
    expect(apiTs).toContain(
      "import { mutationOptions, queryOptions } from '@tanstack/query-core';",
    );
    expect(apiTs).toContain('list:');
    expect(apiTs).toContain('create:');

    const formsTs = await readFile(join(out, 'forms.ts'), 'utf8');
    expect(formsTs).toContain("import { z } from 'zod';");
    expect(formsTs).toContain('UsersCreateBodySchema = z.object({ email: z.string().email() })');
  });
});
