import { existsSync, statSync } from 'node:fs';
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
 * without `components`. Only used to track inputs when the kit module's own
 * `resolveSandboxKitFiles` is not available (an injected `generate`).
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
  components?: string | readonly string[];
  styles?: string | readonly string[];
  wrapper?: string;
  stylesDocs?: string;
  tsconfig?: string;
}

/** The same options as the agent's Vite plugin (`@dudousxd/nestjs-agent/vite`). */
export interface GenuiSandboxKitOptions {
  /**
   * Modules whose exports are the kit's React components: files, globs, directories or packages
   * (`web/components/ui`, `src/genui/kit.ts`, `@mui/material`). Default: the first shadcn
   * `components/ui` dir found.
   */
  components?: string | readonly string[];
  /**
   * The app's style entry files (plain CSS, Sass, a Tailwind stylesheet…): what the model is told
   * about the styles (Tailwind tokens, or the CSS class vocabulary) and the theme's variables.
   */
  styles?: string | readonly string[];
  /** A module whose default export wraps the model's App (theme providers). */
  wrapper?: string;
  /** Guidance on the styles for the model: a markdown file, or the text itself. */
  stylesDocs?: string;
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
  /** The module the writer is loaded from. Default `@dudousxd/nestjs-agent-core/genui/kit`. */
  kitModule?: string;
}

/** The options before nestjs-agent-core 0.53, and what replaced each. */
const LEGACY_OPTIONS: Record<string, string> = {
  entry: '`entry: X` is now `components: X`',
  include: '`include: G` is now `components: G` (globs, files, directories or packages)',
  css: "`css: G` is now `styles: G` (the app's style entry files)",
};

interface SandboxKitFiles {
  files: string[];
  dirs: string[];
}

interface KitModule {
  writeSandboxKitDocs: (options: WriteSandboxKitDocsOptions) => Promise<unknown>;
  resolveSandboxKitFiles?: (
    root: string,
    options: { components?: string | readonly string[]; wrapper?: string },
  ) => SandboxKitFiles | null;
  resolveStyleEntries?: (
    root: string,
    styles: string | readonly string[],
  ) => { files: string[]; missing: string[] };
  collectStyleSources?: (entries: readonly string[]) => { file: string }[];
}

const MIN_CORE = '0.53.0';

async function loadKitModule(specifier: string = GENUI_KIT_MODULE): Promise<KitModule> {
  // A variable specifier keeps the optional peer out of type-checking and bundling.
  let mod: Partial<KitModule>;
  try {
    mod = (await import(specifier)) as Partial<KitModule>;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new CodegenError(
        `genuiSandboxKit() needs "${GENUI_KIT_MODULE}" — install @dudousxd/nestjs-agent-core@>=${MIN_CORE}, or pass \`generate\` to genuiSandboxKit().`,
      );
    }
    if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      throw new CodegenError(
        `genuiSandboxKit() needs "${GENUI_KIT_MODULE}", which the installed @dudousxd/nestjs-agent-core does not export — upgrade it to >=${MIN_CORE}.`,
      );
    }
    throw err;
  }
  if (typeof mod.writeSandboxKitDocs !== 'function') {
    throw new CodegenError(
      `"${GENUI_KIT_MODULE}" has no writeSandboxKitDocs export — upgrade @dudousxd/nestjs-agent-core to >=${MIN_CORE}.`,
    );
  }
  if (typeof mod.resolveStyleEntries !== 'function') {
    throw new CodegenError(
      `The installed @dudousxd/nestjs-agent-core predates genuiSandboxKit({ components, styles, wrapper }) — upgrade it to >=${MIN_CORE}.`,
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
 * Fallback kit-file resolution (a subset of the kit module's): `components` globs, files and
 * directories, else the first existing default `components/ui` dir. Directories are returned too
 * so that adding a component file invalidates the run.
 */
function resolveKitFilesLocally(
  root: string,
  options: { components?: string | readonly string[]; wrapper?: string },
): SandboxKitFiles | null {
  const specs =
    options.components === undefined
      ? DEFAULT_KIT_DIRS.filter((dir) => existsSync(resolve(root, dir))).slice(0, 1)
      : typeof options.components === 'string'
        ? [options.components]
        : [...options.components];
  const files: string[] = [];
  const dirs = new Set<string>();
  for (const spec of specs) {
    if (/[*?{]/.test(spec)) {
      files.push(...fg.sync(spec, { cwd: root, absolute: true, onlyFiles: true }));
      dirs.add(resolve(root, globBase(spec)));
      continue;
    }
    const path = isAbsolute(spec) ? spec : resolve(root, spec);
    if (existsSync(path) && statSync(path).isDirectory()) {
      files.push(...fg.sync('*.{tsx,jsx,ts,js}', { cwd: path, absolute: true, onlyFiles: true }));
      dirs.add(path);
    } else if (existsSync(path)) {
      files.push(path);
      dirs.add(dirname(path));
    }
  }
  if (options.wrapper !== undefined) {
    const wrapper = isAbsolute(options.wrapper) ? options.wrapper : resolve(root, options.wrapper);
    if (existsSync(wrapper)) files.push(wrapper);
  }
  if (files.length === 0 && dirs.size === 0) return null;
  return { files: [...new Set(files)].sort(), dirs: [...dirs] };
}

/**
 * Writes the generative-UI **sandbox kit docs** — the app's design-system components (shadcn
 * `components/ui` by default) with the props read from their TypeScript types, and what its
 * `styles` are (Tailwind tokens, or a CSS class vocabulary, and the theme's variables) — to
 * `.genui/sandbox-kit.json`, where the `@dudousxd/nestjs-agent` server reads them.
 *
 * Runs on every generate pass (one-shot CLI, `--watch`, and the Nest module's watcher). The
 * descriptor lives outside `outDir`, so it is written by the generator itself, not through
 * `emitFiles`; the kit files, the stylesheets (and what they import) and the descriptor are
 * tracked as inputs, so editing a component or a stylesheet regenerates in watch mode and a
 * deleted descriptor is rewritten.
 *
 * Needs the optional peer `@dudousxd/nestjs-agent-core` (>=0.53.0) unless `generate` is given.
 */
export function genuiSandboxKit(options: GenuiSandboxKitOptions = {}): CodegenExtension {
  const legacy = Object.keys(LEGACY_OPTIONS).filter(
    (key) => (options as Record<string, unknown>)[key] !== undefined,
  );
  if (legacy.length > 0) {
    throw new CodegenError(
      `genuiSandboxKit(): ${legacy.map((key) => `\`${key}\``).join(', ')} ${legacy.length > 1 ? 'were' : 'was'} removed — ${legacy.map((key) => LEGACY_OPTIONS[key]).join('; ')}. The options are now the agent's Vite plugin's: components, styles, wrapper, stylesDocs.`,
    );
  }
  const output = options.output ?? DEFAULT_SANDBOX_KIT_OUTPUT;
  const source = {
    ...(options.components !== undefined ? { components: options.components } : {}),
    ...(options.wrapper !== undefined ? { wrapper: options.wrapper } : {}),
  };
  const extension: CodegenExtension & { options: Record<string, unknown> } = {
    name: 'genui-sandbox-kit',
    // Not read by the host: serialized into the config hash, so changing an option
    // invalidates skip-when-unchanged.
    options: {
      ...source,
      styles: options.styles,
      stylesDocs: options.stylesDocs,
      tsconfig: options.tsconfig,
      output,
    },
    async emitFiles(ctx: ExtensionContext) {
      const root = ctx.cwd;
      let generate = options.generate;
      let mod: KitModule | undefined;
      if (!generate) {
        mod = await loadKitModule(options.kitModule);
        generate = mod.writeSandboxKitDocs;
      }
      const resolveFiles = mod?.resolveSandboxKitFiles ?? resolveKitFilesLocally;

      let kit: SandboxKitFiles | null = null;
      try {
        kit = resolveFiles(root, source);
      } catch {
        kit = null;
      }
      if (kit) ctx.trackInput(...kit.files, ...kit.dirs);
      if (options.styles !== undefined) {
        const entries = mod?.resolveStyleEntries
          ? mod.resolveStyleEntries(root, options.styles).files
          : fg.sync(typeof options.styles === 'string' ? [options.styles] : [...options.styles], {
              cwd: root,
              absolute: true,
              onlyFiles: true,
            });
        // What the stylesheets import, too: an edit to a partial changes the vocabulary.
        const files = mod?.collectStyleSources
          ? mod.collectStyleSources(entries).map((source) => source.file)
          : entries;
        ctx.trackInput(...new Set([...entries, ...files]));
      }
      if (options.stylesDocs !== undefined && !options.stylesDocs.includes('\n')) {
        const guide = isAbsolute(options.stylesDocs)
          ? options.stylesDocs
          : resolve(root, options.stylesDocs);
        if (existsSync(guide)) ctx.trackInput(guide);
      }
      // The descriptor itself: a deleted one changes the hash, so the next run rewrites it
      // even when every other input is unchanged.
      ctx.trackInput(isAbsolute(output) ? output : resolve(root, output));

      await generate({
        root,
        output,
        ...source,
        ...(options.styles !== undefined ? { styles: options.styles } : {}),
        ...(options.stylesDocs !== undefined ? { stylesDocs: options.stylesDocs } : {}),
        ...(options.tsconfig !== undefined ? { tsconfig: options.tsconfig } : {}),
      });
      // The descriptor is written outside outDir by `generate`; nothing is emitted here.
      return [];
    },
  };
  return extension;
}
