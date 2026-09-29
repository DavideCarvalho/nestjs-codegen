import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/load-config.js';
import { discoverContractsFast } from '../../src/discovery/contracts-fast.js';
import { generate } from '../../src/generate.js';
import { watch } from '../../src/watch/watcher.js';

// Written under packages/core so `zod` / `@nestjs/common` resolve from its node_modules.
const CORE_DIR = fileURLToPath(new URL('../../', import.meta.url));

const FILES: Record<string, string> = {
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      experimentalDecorators: true,
      skipLibCheck: true,
    },
  }),
  'src/common/zod.pipe.ts': `
    import type { PipeTransform } from '@nestjs/common';
    import type { ZodType } from 'zod';
    export class ZodPipe<T> implements PipeTransform<unknown, T> {
      constructor(private readonly schema: ZodType<T>) {}
      transform(value: unknown): T { return this.schema.parse(value); }
    }
  `,
  'src/users/users.types.ts': `
    export enum Role { Admin = 'admin', Member = 'member' }
    export type Status = 'active' | 'disabled';
    export interface User {
      id: string;
      name: string;
      createdAt: Date;
      role: Role;
      status: Status;
      manager?: User;
      tags: string[];
    }
    export interface Page<T> { data: T[]; total: number }
    export class Account {
      id = 'a';
      balance = 0;
      private token = 't';
      #secret = 's';
      get display(): string { return this.id; }
      describe(): string { return this.#secret + this.token; }
    }
  `,
  'src/users/users.service.ts': `
    import { Account, Role, type Page, type User } from './users.types.js';
    const row = { id: '1', name: 'Ada', createdAt: new Date(), role: Role.Admin, status: 'active' as const, tags: [] };
    export class UsersService {
      async list(): Promise<Page<User>> { return { data: [row], total: 1 }; }
      // inferred: an anonymous object mixing a named type and literals
      async show(id: string) { return { user: row as User, id, flags: [1, 'x'] as [number, string] }; }
      account() { return new Account(); }
    }
  `,
  'src/users/users.controller.ts': `
    import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
    import { z } from 'zod';
    import { ZodPipe } from '../common/zod.pipe.js';
    import { UsersService } from './users.service.js';

    const createBody = z.object({
      name: z.string(),
      role: z.enum(['admin', 'member']).default('member'),
    });
    const searchQuery = z.object({ q: z.string(), page: z.coerce.number().optional() });

    @Controller('api/users')
    export class UsersController {
      constructor(private readonly users: UsersService) {}

      @Get()
      list() { return this.users.list(); }

      @Get(':id')
      show(@Param('id') id: string) { return this.users.show(id); }

      @Get('search')
      search(@Query(new ZodPipe(searchQuery)) query: z.infer<typeof searchQuery>) { return query.q; }

      @Post()
      create(@Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>) { return body; }

      @Post(':id/rename')
      rename(@Param('id') id: string, @Body('name') name: string, @Body('note') note?: string) {
        return { id, name, note };
      }

      @Get(':id/account')
      account() { return this.users.account(); }

      @Delete(':id')
      async remove(@Param('id') _id: string): Promise<void> {}
    }
  `,
};

describe("types: 'standalone'", () => {
  let dir: string;
  let outDir: string;
  let api: string;
  let types: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(CORE_DIR, '.tmp-standalone-'));
    for (const [rel, contents] of Object.entries(FILES)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), contents);
    }
    outDir = join(dir, 'client', 'generated');
    const config = resolveConfig(
      { validation: zodAdapter, types: 'standalone', codegen: { outDir, cwd: dir } },
      dir,
    );
    const routes = await discoverContractsFast({ cwd: dir, glob: 'src/**/*.controller.ts' });
    await generate(config, routes);
    api = await readFile(join(outDir, 'api.ts'), 'utf8');
    types = await readFile(join(outDir, 'types.ts'), 'utf8');
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('imports nothing from the server', () => {
    expect(api).not.toContain('/src/');
    expect(api).not.toContain('ReturnType<import(');
    expect(api).toContain("import type * as $types from './types.js';");
    expect(types).not.toMatch(/^import /m);
  });

  it('resolves inferred return types, hoisting named app types', () => {
    expect(api).toContain('response: Jsonify<{ data: Array<$types.User>; total: number }>');
    expect(api).toContain(
      'response: Jsonify<{ user: $types.User; id: string; flags: [number, string] }>',
    );
    expect(types).toContain('export type Role = "admin" | "member";');
    expect(types).toContain('export type Status = "active" | "disabled";');
    // a self-reference prints the hoisted name; optional drops the strict-mode `| undefined`
    expect(types).toMatch(/export type User = \{[^\n]*manager\?: User;/);
    expect(types).toMatch(/export type User = \{[^\n]*createdAt: Date;/);
  });

  it('prints a class as the JSON it serializes to: public fields only', () => {
    expect(types).toContain('export type Account = { id: string; balance: number };');
  });

  it('types a pipe-validated body/query as the schema INPUT', () => {
    // `.default('member')` makes `role` optional for the sender.
    expect(api).toMatch(/create: \{[^\n]*body: \{ name: string; role\?: "admin" \| "member" \}/);
    expect(api).toMatch(/search: \{[^\n]*query: \{ q: string; page\?: number \}/);
  });

  it('collects named @Body("x") params into one body object', () => {
    expect(api).toMatch(/rename: \{[^\n]*body: \{ name: string; note\?: string \}/);
  });

  it('keeps void responses void', () => {
    expect(api).toMatch(/remove: \{[^\n]*response: Jsonify<void>/);
  });

  it('the generated types compile on their own', () => {
    const check = join(outDir, 'check.ts');
    return writeFile(
      check,
      `import type * as T from './types.js';
       const u: T.User = { id: '', name: '', createdAt: new Date(), role: 'admin', status: 'active', tags: [] };
       const a: T.Account = { id: '', balance: 1 };
       export { u, a };`,
    ).then(() => {
      const program = ts.createProgram([check], {
        strict: true,
        noEmit: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
      });
      const errors = ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      expect(errors).toEqual([]);
    });
  });

  it('records the server files it read as inputs, so a service edit regenerates', async () => {
    const manifest = JSON.parse(await readFile(join(outDir, '.codegen-manifest.json'), 'utf8'));
    expect(manifest.extraInputs).toEqual(
      expect.arrayContaining(['src/users/users.service.ts', 'src/users/users.types.ts']),
    );
  });
});

describe("types: 'standalone' in watch mode", () => {
  it('regenerates when a service the responses come from changes', async () => {
    const dir = await mkdtemp(join(CORE_DIR, '.tmp-standalone-watch-'));
    try {
      for (const [rel, contents] of Object.entries(FILES)) {
        await mkdir(dirname(join(dir, rel)), { recursive: true });
        await writeFile(join(dir, rel), contents);
      }
      const outDir = join(dir, 'client', 'generated');
      const config = resolveConfig(
        {
          validation: zodAdapter,
          types: 'standalone',
          codegen: { outDir, cwd: dir },
          contracts: { glob: 'src/**/*.controller.ts', debounceMs: 50 },
        },
        dir,
      );
      const watcher = await watch(config);
      try {
        const service = join(dir, 'src/users/users.service.ts');
        const before = await readFile(service, 'utf8');
        await writeFile(service, before.replace("flags: [1, 'x']", "extra: true, flags: [1, 'x']"));
        const deadline = Date.now() + 20_000;
        let api = '';
        while (Date.now() < deadline) {
          api = await readFile(join(outDir, 'api.ts'), 'utf8');
          if (api.includes('extra: boolean')) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(api).toContain('extra: boolean');
      } finally {
        await watcher.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
