import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Watch mode keeps the two type-checked programs discovery uses (schema inference's
 * and the mixin one) across passes instead of building them again, since loading
 * their lib files is most of a pass. These specs pin both halves of that: no
 * Project is built for a pass that only edits files, and what the kept programs
 * produce after any sequence of edits is exactly what a fresh run produces.
 */

const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock('ts-morph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ts-morph')>();
  class CountedProject extends actual.Project {
    constructor(...args: ConstructorParameters<typeof actual.Project>) {
      super(...args);
      constructed.count++;
    }
  }
  return { ...actual, Project: CountedProject };
});

const { PersistentDiscovery } = await import('../../src/discovery/contracts-fast.js');
const { Node, Project } = await import('ts-morph');
const { clearSchemaTypeProject, inferSchema, invalidateSchemaTypeProject, requestTypeOf } =
  await import('../../src/discovery/schema-type-inference.js');

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FILES: Record<string, string> = {
  'tsconfig.json': JSON.stringify({
    compilerOptions: { target: 'ES2022', strict: true, experimentalDecorators: true },
  }),
  'src/zod.pipe.ts': `import type { ZodType } from 'zod';
export class ZodPipe<T> {
  constructor(private readonly schema: ZodType<T>) {}
}
`,
  'src/fields.ts': `import { z } from 'zod';
import { status } from './status';
export const titleField = z.string().min(1);
export const statusField = z.object({ status });
`,
  'src/status.ts': `import { z } from 'zod';
export const status = z.enum(['draft', 'live']);
`,
  'src/helpers.ts': `import { z } from 'zod';
export const slug = z.string().regex(/^[a-z-]+$/);
declare global {
  interface NoteMeta {
    author: string;
  }
}
`,
  'src/notes.schema.ts': `import { z } from 'zod';
import { statusField, titleField } from './fields';
import { slug } from './helpers';
export const createNote = z.object({
  title: titleField,
  state: statusField,
  slug,
  meta: z.custom<NoteMeta>(),
  pinned: z.boolean().default(false),
});
`,
  'src/note.dto.ts': `export class NoteDto {
  id!: string;
  title!: string;
}
`,
  'src/notes.controller.ts': `import { Body, Controller, Get, Post } from '@nestjs/common';
import { ZodPipe } from './zod.pipe';
import { createNote } from './notes.schema';
import { NoteDto } from './note.dto';

@Controller('notes')
export class NotesController {
  @Post()
  create(@Body(new ZodPipe(createNote)) body: unknown): NoteDto {
    return body as NoteDto;
  }

  @Get()
  list(): NoteDto[] {
    return [];
  }
}
`,
  'src/table-factory.ts': `import { Body, Post } from '@nestjs/common';

export class Widget {
  id!: string;
}

export interface Paginated<T> {
  data: T[];
  totalCount: number;
}

export function createTableController<E extends object>(entity: new () => E) {
  class GeneratedTableController {
    @Post()
    async rows(@Body() body: { page?: number }): Promise<Paginated<E>> {
      return { data: [], totalCount: 0 };
    }
  }
  return GeneratedTableController;
}
`,
  'src/widgets.controller.ts': `import { Controller } from '@nestjs/common';
import { Widget, createTableController } from './table-factory';

@Controller('widgets')
export class WidgetsController extends createTableController(Widget) {}
`,
};

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function scaffold(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codegen-persistent-programs-'));
  roots.push(root);
  // zod and @nestjs/common, for the schema program to type the schemas with.
  await symlink(join(CORE, 'node_modules'), join(root, 'node_modules'));
  for (const [rel, text] of Object.entries(FILES)) await put(root, rel, text);
  return root;
}

async function put(root: string, rel: string, text: string): Promise<string> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
  return abs;
}

const OPTS = (cwd: string) => ({ cwd, glob: 'src/**/*.controller.ts' });

/**
 * A cold discovery from a module graph of its own: the mixin Project is module
 * state, and a cold run in the same module instance would drop the one the watch
 * session is keeping.
 */
async function freshRun(root: string): Promise<string> {
  vi.resetModules();
  const fresh = await import('../../src/discovery/contracts-fast.js');
  return JSON.stringify(await fresh.discoverContractsFast(OPTS(root)), null, 1);
}

/** The request type of the controller's `@Body` schema, inferred through `discovery`. */
function bodyType(discovery: InstanceType<typeof Project>, controller: string): string {
  const pipe = discovery
    .getSourceFileOrThrow(controller)
    .getDescendants()
    .find((node) => Node.isNewExpression(node) && node.getExpression().getText() === 'ZodPipe');
  const schema = pipe && Node.isNewExpression(pipe) ? pipe.getArguments()[0] : undefined;
  if (!schema) throw new Error('no schema argument');
  const inferred = inferSchema(schema, discovery);
  if (inferred.kind !== 'schema') throw new Error(`schema not inferred: ${inferred.kind}`);
  return requestTypeOf(inferred.types);
}

describe('persistent discovery programs', () => {
  it('re-reads files only the schema program holds, without building a new one', async () => {
    const root = await scaffold();
    const controller = join(root, 'src/notes.controller.ts');
    // Holding just the controller, so every file the schema needs is read by the
    // schema program itself, from disk.
    const discoveryWith = () => {
      const project = new Project({
        compilerOptions: { strict: true },
        skipAddingFilesFromTsConfig: true,
        skipLoadingLibFiles: true,
        skipFileDependencyResolution: true,
      });
      project.addSourceFileAtPath(controller);
      return project;
    };
    const discovery = discoveryWith();
    expect(bodyType(discovery, controller)).toContain('status: "draft" | "live"');

    await put(
      root,
      'src/status.ts',
      FILES['src/status.ts'].replace("'live'", "'live', 'archived'"),
    );
    constructed.count = 0;
    invalidateSchemaTypeProject(discovery);
    const watched = bodyType(discovery, controller);
    expect(constructed.count).toBe(0);

    const fresh = discoveryWith();
    expect(watched).toBe(bodyType(fresh, controller));
    expect(watched).toContain('status: "draft" | "live" | "archived"');
    clearSchemaTypeProject(discovery);
    clearSchemaTypeProject(fresh);
  });

  it('builds no Project on a pass that only edits files', async () => {
    const root = await scaffold();
    const session = await PersistentDiscovery.create(OPTS(root));
    session.discover();

    const edits: Array<[string, string]> = [
      ['src/notes.schema.ts', FILES['src/notes.schema.ts'].replace('(false)', '(true)')],
      ['src/fields.ts', FILES['src/fields.ts'].replace('min(1)', 'min(2)')],
      ['src/note.dto.ts', FILES['src/note.dto.ts'].replace('title!: string;', 'body!: string;')],
      ['src/table-factory.ts', FILES['src/table-factory.ts'].replace('totalCount', 'total')],
      [
        'src/notes.controller.ts',
        FILES['src/notes.controller.ts'].replace('@Get()', "@Get('all')"),
      ],
    ];
    constructed.count = 0;
    for (const [rel, text] of edits) {
      const routes = await session.rediscover([await put(root, rel, text)]);
      expect(routes.length).toBeGreaterThan(0);
    }

    expect(constructed.count).toBe(0);
  });

  it('builds the programs again when the watcher reports a file added or removed', async () => {
    const root = await scaffold();
    const session = await PersistentDiscovery.create(OPTS(root));
    session.discover();

    constructed.count = 0;
    const added = await put(root, 'src/extra.schema.ts', 'export const extra = 1;\n');
    await session.rediscover([added], { filesAddedOrRemoved: true });

    // The schema program, its scratch Project, and the mixin Project.
    expect(constructed.count).toBe(3);
  });

  it('after any sequence of edits, produces exactly what a fresh run produces', async () => {
    const root = await scaffold();
    const session = await PersistentDiscovery.create(OPTS(root));
    expect(JSON.stringify(session.discover(), null, 1)).toBe(await freshRun(root));

    const steps: Array<{
      name: string;
      apply: () => Promise<string[]>;
      filesAddedOrRemoved?: boolean;
    }> = [
      {
        name: 'a schema a controller imports gains a field',
        apply: async () => [
          await put(
            root,
            'src/notes.schema.ts',
            FILES['src/notes.schema.ts'].replace('pinned:', 'tags: z.array(z.string()), pinned:'),
          ),
        ],
      },
      {
        name: 'a file only the schema imports changes',
        apply: async () => [
          await put(
            root,
            'src/fields.ts',
            FILES['src/fields.ts'].replace('z.string().min(1)', 'z.number()'),
          ),
        ],
      },
      {
        // Unwatched, so no hint: only a program reading it from disk sees the edit.
        name: 'a file two imports below the schema changes',
        apply: async () => {
          await put(
            root,
            'src/status.ts',
            FILES['src/status.ts'].replace("'live'", "'live', 'archived'"),
          );
          return [];
        },
      },
      {
        name: 'a schema stops importing the file that declares a global it uses',
        apply: async () => [
          await put(
            root,
            'src/notes.schema.ts',
            FILES['src/notes.schema.ts']
              .replace("import { slug } from './helpers';\n", '')
              .replace('  slug,\n', ''),
          ),
        ],
      },
      {
        name: 'a DTO a controller imports gains a field',
        apply: async () => [
          await put(
            root,
            'src/note.dto.ts',
            FILES['src/note.dto.ts'].replace(
              'title!: string;',
              'title!: string;\n  done!: boolean;',
            ),
          ),
        ],
      },
      {
        name: "the mixin factory changes its routes' response type",
        apply: async () => [
          await put(
            root,
            'src/table-factory.ts',
            FILES['src/table-factory.ts'].replace('Promise<Paginated<E>>', 'Promise<E[]>'),
          ),
        ],
      },
      {
        name: 'a controller is added',
        filesAddedOrRemoved: true,
        apply: async () => [
          await put(
            root,
            'src/tags.controller.ts',
            `import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from './zod.pipe';

const createTag = z.object({ label: z.string().max(20) });

@Controller('tags')
export class TagsController {
  @Post()
  create(@Body(new ZodPipe(createTag)) body: unknown): { ok: true } {
    return { ok: true };
  }
}
`,
          ),
        ],
      },
      {
        name: 'a controller is removed',
        filesAddedOrRemoved: true,
        apply: async () => {
          const abs = join(root, 'src/tags.controller.ts');
          await unlink(abs);
          return [abs];
        },
      },
      {
        name: 'a controller moves its schema to a new file',
        filesAddedOrRemoved: true,
        apply: async () => [
          await put(
            root,
            'src/notes-v2.schema.ts',
            `import { z } from 'zod';
export const createNote = z.object({ heading: z.string(), body: z.string().optional() });
`,
          ),
          await put(
            root,
            'src/notes.controller.ts',
            FILES['src/notes.controller.ts'].replace("'./notes.schema'", "'./notes-v2.schema'"),
          ),
        ],
      },
      {
        name: 'a schema stops being imported and is then edited',
        apply: async () => [
          await put(root, 'src/notes.schema.ts', 'export const unrelated = 1;\n'),
        ],
      },
      {
        name: 'a controller imports a schema that does not exist yet',
        apply: async () => [
          await put(
            root,
            'src/notes.controller.ts',
            FILES['src/notes.controller.ts'].replace("'./notes.schema'", "'./later.schema'"),
          ),
        ],
      },
      {
        // Outside every watched glob, so no hint and no add reported.
        name: 'the missing schema appears unannounced',
        apply: async () => {
          await put(
            root,
            'src/later.schema.ts',
            `import { z } from 'zod';
export const createNote = z.object({ late: z.number().int() });
`,
          );
          return [];
        },
      },
      {
        name: 'the mixin factory imports its page type from a file that does not exist yet',
        apply: async () => [
          await put(
            root,
            'src/table-factory.ts',
            `import type { Paginated } from './paged';\n${FILES['src/table-factory.ts'].replace(
              /export interface Paginated<T> \{[^}]*\}\n/,
              '',
            )}`,
          ),
        ],
      },
      {
        name: 'the missing page type appears unannounced',
        apply: async () => {
          await put(
            root,
            'src/paged.ts',
            'export interface Paginated<T> {\n  rows: T[];\n  next?: string;\n}\n',
          );
          return [];
        },
      },
      {
        name: 'a mixin controller imports a factory that does not exist yet',
        apply: async () => [
          await put(
            root,
            'src/widgets.controller.ts',
            FILES['src/widgets.controller.ts'].replace("'./table-factory'", "'./table-factory-v2'"),
          ),
        ],
      },
      {
        // Outside every watched glob, so no hint and no add reported.
        name: 'the missing factory appears unannounced',
        apply: async () => {
          await put(
            root,
            'src/table-factory-v2.ts',
            FILES['src/table-factory.ts'].replace('Promise<Paginated<E>>', 'Promise<E[]>'),
          );
          return [];
        },
      },
      {
        name: 'a controller is edited after all of that',
        apply: async () => [
          await put(
            root,
            'src/notes.controller.ts',
            FILES['src/notes.controller.ts']
              .replace("'./notes.schema'", "'./later.schema'")
              .replace('@Get()', "@Get('all')"),
          ),
        ],
      },
    ];

    for (const step of steps) {
      const changed = await step.apply();
      const watched = await session.rediscover(changed, {
        filesAddedOrRemoved: step.filesAddedOrRemoved ?? false,
      });
      console.log(
        step.name,
        JSON.stringify(
          watched.map(
            (r) => r.contract?.contractSource.body ?? r.contract?.contractSource.response,
          ),
        ),
      );
      expect(JSON.stringify(watched, null, 1), step.name).toBe(await freshRun(root));
    }
  }, 120_000);
});
