import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { Project } from 'ts-morph';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractSchemaFromDto } from '../../src/discovery/dto-to-ir.js';
import type { RouteDescriptor } from '../../src/discovery/types.js';
import { emitForms } from '../../src/emit/emit-forms.js';

// A self-recursive class-validator DTO (the ColumnFilter shape from the field report).
const RECURSIVE_DTO = `
  class ColumnFilter {
    @IsString() @IsOptional() field?: string;
    @ValidateNested({ each: true }) @Type(() => ColumnFilter) @IsOptional() and?: ColumnFilter[];
    @ValidateNested({ each: true }) @Type(() => ColumnFilter) @IsOptional() or?: ColumnFilter[];
  }
  class Dto { @ValidateNested() @Type(() => ColumnFilter) filter!: ColumnFilter; }`;

function ir(source: string, cls = 'Dto') {
  const p = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const f = p.createSourceFile('dto.ts', source);
  return extractSchemaFromDto(f.getClassOrThrow(cls), f, p);
}

function routes(): RouteDescriptor[] {
  return [
    {
      method: 'POST',
      path: '/q',
      name: 'q.run',
      params: [],
      contract: {
        contractSource: {
          query: null,
          body: 'Dto',
          response: 'unknown',
          bodySchema: ir(RECURSIVE_DTO),
        },
      },
    },
  ];
}

// Errors that a bare unannotated recursive const would raise.
// TS7022/7023: implicit-any self-reference; TS2502: circularly references itself.
const CYCLE_ERRORS = new Set([7022, 7023, 2502, 2577]);

// packages/core — `zod` resolves from here via the workspace install, so a file
// written under this dir can `import { z } from 'zod'` at both compile + runtime.
const CORE_DIR = fileURLToPath(new URL('../../', import.meta.url));

describe('recursive DTO → forms.ts (zod, real compile + runtime)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(CORE_DIR, '.tmp-recursive-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('emits a hoisted TS type alias + annotated z.lazy const', async () => {
    await emitForms(routes(), dir, undefined, zodAdapter);
    const out = await readFile(join(dir, 'forms.ts'), 'utf8');
    expect(out).toContain('type ColumnFilter = {');
    expect(out).toMatch(/const ColumnFilterSchema: z\.ZodType<ColumnFilter> = z\.object\(/);
    expect(out).toContain('z.lazy(() => ColumnFilterSchema)');
    // The old degraded placeholder must be gone.
    expect(out).not.toContain('z.unknown() /* recursive');
  });

  it('the generated file type-checks with no self-reference/circular errors', async () => {
    await emitForms(routes(), dir, undefined, zodAdapter);
    const file = join(dir, 'forms.ts');
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2020,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === file);
    const cycleErrors = diagnostics.filter((d) => CYCLE_ERRORS.has(d.code));
    expect(
      cycleErrors.map(
        (d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      ),
    ).toEqual([]);
  });

  it('validates cyclic data at runtime via z.lazy', async () => {
    await emitForms(routes(), dir, undefined, zodAdapter);
    const mod = await import(/* @vite-ignore */ join(dir, 'forms.ts'));
    const schema = mod.RunBodySchema;
    // Nested-three-levels-deep cyclic value is accepted.
    const ok = schema.safeParse({
      filter: { field: 'a', and: [{ field: 'b', or: [{ field: 'c' }] }] },
    });
    expect(ok.success).toBe(true);
    // A wrong leaf type is rejected (proves the recursion is really validated).
    const bad = schema.safeParse({ filter: { and: [{ field: 123 }] } });
    expect(bad.success).toBe(false);
  });
});
