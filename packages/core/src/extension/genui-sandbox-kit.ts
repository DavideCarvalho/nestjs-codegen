import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import fg from 'fast-glob';
import { CodegenError } from '../exceptions.js';
import type { CodegenExtension, ExtensionContext } from './types.js';

/** The module that owns the sandbox-kit docs generator (optional peer dependency). */
export const GENUI_KIT_MODULE = '@dudousxd/nestjs-agent-core/genui/kit';

/** Where the Nest server reads the descriptor from by default (relative to the app root). */
export const DEFAULT_SANDBOX_KIT_OUTPUT = '.genui/sandbox-kit.json';

/**
 * Where a shadcn `components.json` puts `ui` by default — the same list the kit module probes
 * when neither `entry` nor `include` is given. Only used to track inputs when the kit module's
 * own `resolveSandboxKitFiles` is not available (an injected `generate`).
 */
const DEFAULT_KIT_DIRS = [
  'inertia/components/ui',
  'resources/js/components/ui',
  'src/components/ui',
  'app/components/ui',
  'components/ui',
] as const;

/** What {@link genuiSandboxKit} passes to `writeSandboxKitDocs`. */
export interface WriteSandboxKitDocsOptions {
  root: string;
  output: string;
  entry?: string;
  include?: string | readonly string[];
  css?: string | readonly string[];
  tsconfig?: string;
}

export interface GenuiSandboxKitOptions {
  /** A module whose exports are the kit (e.g. `src/genui/kit.ts`). */
  entry?: string;
  /** A glob (or several) whose files' exports are the kit (e.g. `web/components/ui/*.tsx`). */
  include?: string | readonly string[];
  /** Stylesheet glob(s) whose custom properties become the sandbox theme. */
  css?: string | readonly string[];
  /** The tsconfig the component prop types are read through. */
  tsconfig?: string;
  /**
   * Where the descriptor is written, relative to the app `cwd` (or absolute).
   * @default '.genui/sandbox-kit.json'
   */
  output?: string;
  /**
   * The docs writer. Defaults to `writeSandboxKitDocs` from
   * `@dudousxd/nestjs-agent-core/genui/kit`; inject one to test, or to use another generator.
   * It is expected to write `output` itself (and only when the contents change).
   */
  generate?: (options: WriteSandboxKitDocsOptions) => Promise<unknown>;
}

interface SandboxKitFiles {
  entry?: string;
  files: string[];
  dirs: string[];
}

interface KitModule {
  writeSandboxKitDocs: (options: WriteSandboxKitDocsOptions) => Promise<unknown>;
  resolveSandboxKitFiles?: (
    root: string,
    options: { entry?: string; include?: string | readonly string[] },
  ) => SandboxKitFiles | null;
}

async function loadKitModule(): Promise<KitModule> {
  // A variable specifier keeps the optional peer out of type-checking and bundling.
  const specifier: string = GENUI_KIT_MODULE;
  let mod: Partial<KitModule>;
  try {
    mod = (await import(specifier)) as Partial<KitModule>;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new CodegenError(
        `genuiSandboxKit() needs "${GENUI_KIT_MODULE}" — install @dudousxd/nestjs-agent-core@>=0.51.0, or pass \`generate\` to genuiSandboxKit().`,
      );
    }
    if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      throw new CodegenError(
        `genuiSandboxKit() needs "${GENUI_KIT_MODULE}", which the installed @dudousxd/nestjs-agent-core does not export — upgrade it to >=0.51.0.`,
      );
    }
    throw err;
  }
  if (typeof mod.writeSandboxKitDocs !== 'function') {
    throw new CodegenError(
      `"${GENUI_KIT_MODULE}" has no writeSandboxKitDocs export — upgrade @dudousxd/nestjs-agent-core to >=0.51.0.`,
    );
  }
  return mod as KitModule;
}

/** The directory part of a glob before its first wildcard segment. */
function globBase(glob: string): string {
  const base: string[] = [];
  for (const part of glob.replace(/\\/g, '/').split('/')) {
    if (/[*?{[]/.test(part)) break;
    base.push(part);
  }
  return base.join('/');
}

/**
 * Fallback kit-file resolution (mirrors the kit module's): `entry`, else `include`, else the
 * first existing default `components/ui` dir. Directories are returned too so that adding a
 * component file invalidates the run.
 */
function resolveKitFilesLocally(
  root: string,
  options: { entry?: string; include?: string | readonly string[] },
): SandboxKitFiles | null {
  if (options.entry !== undefined) {
    const entry = isAbsolute(options.entry) ? options.entry : resolve(root, options.entry);
    return { entry, files: [entry], dirs: [dirname(entry)] };
  }
  const include =
    options.include ??
    DEFAULT_KIT_DIRS.filter((dir) => existsSync(resolve(root, dir))).map(
      (dir) => `${dir}/*.{tsx,jsx,ts,js}`,
    )[0];
  if (include === undefined) return null;
  const globs = typeof include === 'string' ? [include] : [...include];
  const files = fg.sync(globs, { cwd: root, absolute: true, onlyFiles: true }).sort();
  return { files, dirs: [...new Set(globs.map((glob) => resolve(root, globBase(glob))))] };
}

/**
 * Writes the generative-UI **sandbox kit docs** — the app's design-system components (shadcn
 * `components/ui` by default) with the props read from their TypeScript types — to
 * `.genui/sandbox-kit.json`, where the `@dudousxd/nestjs-agent` server reads them.
 *
 * Runs on every generate pass (one-shot CLI, `--watch`, and the Nest module's watcher). The
 * descriptor lives outside `outDir`, so it is written by the generator itself, not through
 * `emitFiles`; the kit files, stylesheets and the descriptor are tracked as inputs, so editing
 * a component regenerates in watch mode and a deleted descriptor is rewritten.
 *
 * Needs the optional peer `@dudousxd/nestjs-agent-core` (>=0.51.0) unless `generate` is given.
 */
export function genuiSandboxKit(options: GenuiSandboxKitOptions = {}): CodegenExtension {
  const output = options.output ?? DEFAULT_SANDBOX_KIT_OUTPUT;
  const source = {
    ...(options.entry !== undefined ? { entry: options.entry } : {}),
    ...(options.include !== undefined ? { include: options.include } : {}),
  };
  const extension: CodegenExtension & { options: Record<string, unknown> } = {
    name: 'genui-sandbox-kit',
    // Not read by the host: serialized into the config hash, so changing an option
    // invalidates skip-when-unchanged.
    options: { ...source, css: options.css, tsconfig: options.tsconfig, output },
    async emitFiles(ctx: ExtensionContext) {
      const root = ctx.cwd;
      let generate = options.generate;
      let resolveFiles = resolveKitFilesLocally;
      if (!generate) {
        const mod = await loadKitModule();
        generate = mod.writeSandboxKitDocs;
        if (typeof mod.resolveSandboxKitFiles === 'function') {
          resolveFiles = mod.resolveSandboxKitFiles;
        }
      }

      const kit = resolveFiles(root, source);
      if (kit) ctx.trackInput(...kit.files, ...kit.dirs);
      if (options.css !== undefined) {
        const css = typeof options.css === 'string' ? [options.css] : [...options.css];
        ctx.trackInput(...fg.sync(css, { cwd: root, absolute: true, onlyFiles: true }));
      }
      // The descriptor itself: a deleted one changes the hash, so the next run rewrites it
      // even when every other input is unchanged.
      ctx.trackInput(isAbsolute(output) ? output : resolve(root, output));

      await generate({
        root,
        output,
        ...source,
        ...(options.css !== undefined ? { css: options.css } : {}),
        ...(options.tsconfig !== undefined ? { tsconfig: options.tsconfig } : {}),
      });
      // The descriptor is written outside outDir by `generate`; nothing is emitted here.
      return [];
    },
  };
  return extension;
}
