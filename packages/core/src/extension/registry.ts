import { relative, resolve } from 'node:path';
import { Project } from 'ts-morph';
import type { ResolvedConfig } from '../config/types.js';
import { createDiscoveryProject, resolveTsconfigPath } from '../discovery/contracts-fast.js';
import type { RouteDescriptor } from '../discovery/types.js';
import { CodegenError } from '../exceptions.js';
import type { ApiClientLayer, CodegenExtension, EmittedFile, ExtensionContext } from './types.js';

/**
 * Resolve the single-slot `apiClientLayer` hook. At most one extension may claim it;
 * a second claimer throws a {@link CodegenError} naming both extensions. An unclaimed
 * `apiClientLayer` means leaves stay bare callables backed by the neutral fetcher.
 */
export function resolveApiSlots(extensions: readonly CodegenExtension[]): {
  layer?: ApiClientLayer;
} {
  let layer: ApiClientLayer | undefined;
  let layerOwner: string | undefined;

  for (const ext of extensions) {
    if (ext.apiClientLayer) {
      if (layer) {
        throw new CodegenError(
          `api client layer claimed by both "${layerOwner}" and "${ext.name}" — only one extension may set apiClientLayer.`,
        );
      }
      layer = ext.apiClientLayer;
      layerOwner = ext.name;
    }
  }

  return {
    ...(layer ? { layer } : {}),
  };
}

/** Output filenames the core always owns — an extension emitting one of these is an error. */
const CORE_FILES = new Set(['routes.ts', 'api.ts', 'forms.ts', 'index.d.ts', 'pages.d.ts']);

/**
 * Merge `incoming` entries into `target`, enforcing a single exclusive-ownership policy:
 * a key already present in `target` is a collision and throws, naming the prior owner and
 * the offending extension. One collision format for every "two extensions both produced X"
 * case (api members, emitted files, …).
 *
 * @param target  the accumulating map (key → value); also records ownership.
 * @param incoming entries the current extension contributes.
 * @param owner    the extension currently contributing (named in the error).
 * @param describe builds the error message given the colliding key, prior owner and owner.
 */
export function mergeExclusive<V>(
  target: Map<string, { value: V; owner: string }>,
  incoming: Iterable<readonly [string, V]>,
  {
    owner,
    describe,
  }: {
    owner: string;
    describe: (key: string, prevOwner: string, owner: string) => string;
  },
): void {
  for (const [key, value] of incoming) {
    const prev = target.get(key);
    if (prev !== undefined) {
      throw new CodegenError(describe(key, prev.owner, owner));
    }
    target.set(key, { value, owner });
  }
}

/**
 * Build the shared {@link ExtensionContext}. `routes` is exposed as a live getter so an
 * extension reading `ctx.routes` during `emitFiles` sees the post-`transformRoutes` IR.
 * Both ts-morph `Project`s are created lazily on first call (extensions that do no AST
 * work never pay for either), and each is memoized so N extensions share one parse.
 */
export function createExtensionContext(
  config: ResolvedConfig,
  getRoutes: () => readonly RouteDescriptor[],
  trackedInputs?: Set<string>,
): ExtensionContext {
  let project: Project | undefined;
  let tsconfigProject: Project | undefined;
  return {
    cwd: config.codegen.cwd,
    outDir: config.codegen.outDir,
    config,
    get routes() {
      return getRoutes();
    },
    trackInput(...paths: string[]) {
      if (!trackedInputs) return;
      for (const path of paths) {
        if (!path) continue;
        // Normalize to cwd-relative so the manifest stays portable across
        // machines and checkout locations.
        trackedInputs.add(relative(config.codegen.cwd, resolve(config.codegen.cwd, path)));
      }
    },
    project() {
      if (!project) {
        project = new Project({
          skipAddingFilesFromTsConfig: true,
          skipLoadingLibFiles: true,
          skipFileDependencyResolution: true,
          compilerOptions: { allowJs: true, strict: false },
        });
      }
      return project;
    },
    tsconfigProject() {
      if (!tsconfigProject) {
        // The same loader the discovery pass uses, so an extension following a
        // `@/...` import resolves it exactly as discovery did — and inherits the
        // EACCES-proof tsconfig read instead of reimplementing it.
        tsconfigProject = createDiscoveryProject(
          resolveTsconfigPath(config.codegen.cwd, config.app?.tsconfig ?? undefined),
        );
      }
      return tsconfigProject;
    },
  };
}

/**
 * Run every extension's `transformRoutes` hook in registration order, chaining the
 * result (each sees the previous output). An extension may mutate in place and return
 * void, or return a new array.
 */
export async function applyTransformRoutes(
  routes: RouteDescriptor[],
  extensions: readonly CodegenExtension[],
  ctx: ExtensionContext,
): Promise<RouteDescriptor[]> {
  let current = routes;
  for (const ext of extensions) {
    if (!ext.transformRoutes) continue;
    const result = await ext.transformRoutes(current, ctx);
    if (Array.isArray(result)) current = result;
  }
  return current;
}

/**
 * Run every extension's `emitFiles` hook and return the accumulated files. Throws a
 * {@link CodegenError} if two extensions emit the same path, or if an extension tries to
 * emit a core-owned file. Paths are normalized to forward slashes for collision checks.
 */
export async function collectEmittedFiles(
  extensions: readonly CodegenExtension[],
  ctx: ExtensionContext,
): Promise<EmittedFile[]> {
  const files: EmittedFile[] = [];
  const owners = new Map<string, { value: EmittedFile; owner: string }>();

  for (const ext of extensions) {
    if (!ext.emitFiles) continue;
    const emitted = await ext.emitFiles(ctx);
    for (const file of emitted) {
      const key = file.path.replace(/\\/g, '/').replace(/^\.\//, '');
      if (CORE_FILES.has(key)) {
        throw new CodegenError(
          `Extension "${ext.name}" tried to emit the core-owned file "${file.path}". Core files (${[...CORE_FILES].join(', ')}) cannot be produced by extensions.`,
        );
      }
      mergeExclusive(owners, [[key, file] as const], {
        owner: ext.name,
        describe: (_key, prevOwner, owner) =>
          `Output file "${file.path}" is emitted by both "${prevOwner}" and "${owner}". Two extensions cannot write the same file.`,
      });
      files.push(file);
    }
  }

  return files;
}
