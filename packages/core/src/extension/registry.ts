import { Project } from 'ts-morph';
import type { ResolvedConfig } from '../config/types.js';
import type { RouteDescriptor } from '../discovery/types.js';
import { CodegenError } from '../exceptions.js';
import type {
  ApiClientLayer,
  ApiTransport,
  CodegenExtension,
  EmittedFile,
  ExtensionContext,
} from './types.js';

/**
 * Resolve the two single-slot api.ts hooks. At most one extension may claim each slot;
 * a second claimer throws a {@link CodegenError} naming both extensions. An unclaimed
 * `apiTransport` means the host falls back to the bundled fetcher transport; an unclaimed
 * `apiClientLayer` means leaves stay bare callables.
 */
export function resolveApiSlots(extensions: readonly CodegenExtension[]): {
  transport?: ApiTransport;
  layer?: ApiClientLayer;
} {
  let transport: ApiTransport | undefined;
  let transportOwner: string | undefined;
  let layer: ApiClientLayer | undefined;
  let layerOwner: string | undefined;

  for (const ext of extensions) {
    if (ext.apiTransport) {
      if (transport) {
        throw new CodegenError(
          `api transport claimed by both "${transportOwner}" and "${ext.name}" — only one extension may set apiTransport.`,
        );
      }
      transport = ext.apiTransport;
      transportOwner = ext.name;
    }
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
    ...(transport ? { transport } : {}),
    ...(layer ? { layer } : {}),
  };
}

/** Output filenames the core always owns — an extension emitting one of these is an error. */
const CORE_FILES = new Set(['routes.ts', 'api.ts', 'forms.ts', 'index.d.ts', 'pages.d.ts']);

/**
 * Build the shared {@link ExtensionContext}. `routes` is exposed as a live getter so an
 * extension reading `ctx.routes` during `emitFiles` sees the post-`transformRoutes` IR.
 * The ts-morph `Project` is created lazily on first `project()` call (extensions that do
 * no AST work never pay for it).
 */
export function createExtensionContext(
  config: ResolvedConfig,
  getRoutes: () => readonly RouteDescriptor[],
): ExtensionContext {
  let project: Project | undefined;
  return {
    cwd: config.codegen.cwd,
    outDir: config.codegen.outDir,
    config,
    get routes() {
      return getRoutes();
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
  const owners = new Map<string, string>();

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
      const prev = owners.get(key);
      if (prev !== undefined) {
        throw new CodegenError(
          `Output file "${file.path}" is emitted by both "${prev}" and "${ext.name}". Two extensions cannot write the same file.`,
        );
      }
      owners.set(key, ext.name);
      files.push(file);
    }
  }

  return files;
}
