import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractSchemaFromDto } from '@dudousxd/nestjs-codegen';
import { emitForms } from '@dudousxd/nestjs-codegen';
import type { RouteDescriptor } from '@dudousxd/nestjs-codegen';
import { Project } from 'ts-morph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { valibotAdapter } from '../src/index.js';

function ir(source: string) {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const file = project.createSourceFile('dto.ts', source);
  return extractSchemaFromDto(file.getClassOrThrow('Dto'), file, project);
}

describe('emit-forms with the valibot adapter (end-to-end)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestjs-codegen-valibot-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renders forms.ts with valibot when the adapter is valibot', async () => {
    const routes: RouteDescriptor[] = [
      {
        method: 'POST',
        path: '/auth/login',
        name: 'auth.login',
        params: [],
        contract: {
          contractSource: {
            query: null,
            body: 'LoginDto',
            response: 'unknown',
            bodySchema: ir(
              'class Dto { @IsEmail() email!: string; @MinLength(8) password!: string; }',
            ),
          },
        },
      },
    ];

    const wrote = await emitForms(routes, dir, undefined, valibotAdapter);
    expect(wrote).toBe(true);

    const forms = await readFile(join(dir, 'forms.ts'), 'utf8');
    expect(forms).toContain("import * as v from 'valibot';");
    expect(forms).toContain(
      'export const LoginBodySchema = v.object({ email: v.pipe(v.string(), v.email()), password: v.pipe(v.string(), v.minLength(8)) });',
    );
    expect(forms).toContain('export type LoginBody = v.InferOutput<typeof LoginBodySchema>;');
    expect(forms).toContain('"auth.login": LoginBodySchema');
    expect(forms).not.toContain("from 'zod'");
  });

  it('warns + skips a defineContract (zod-only) schema under a non-zod adapter', async () => {
    const routes: RouteDescriptor[] = [
      {
        method: 'POST',
        path: '/x',
        name: 'x.create',
        params: [],
        contract: {
          contractSource: {
            query: null,
            body: null,
            response: 'unknown',
            // hand-written zod (defineContract) — no IR
            bodyZodText: 'z.object({ a: z.string() })',
          },
        },
      },
    ];
    const wrote = await emitForms(routes, dir, undefined, valibotAdapter);
    // Nothing renderable via valibot → no file.
    expect(wrote).toBe(false);
  });
});
