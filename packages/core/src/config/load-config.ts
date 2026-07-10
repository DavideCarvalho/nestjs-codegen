import { access } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAdapter } from '../adapters/registry.js';
import { ConfigError } from '../exceptions.js';
import type { ResolvedConfig, UserConfig } from './types.js';

/** Config file names, in lookup order. The legacy `nestjs-inertia.config.ts` is
 * still accepted for back-compat with projects migrating from nestjs-inertia. */
const CONFIG_FILES = ['nestjs-codegen.config.ts', 'nestjs-inertia.config.ts'] as const;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function importTs(filePath: string): Promise<unknown> {
  const fileUrl = pathToFileURL(filePath).href;

  // Native-first: modern Node (>=22.18 / 23.6 / 24 / 25) strips TypeScript types
  // natively, so a plain dynamic import loads a `.ts` config with zero deps. This is
  // also the only path that works on Node 25, where tsx 4.22.4's resolver appends a
  // `?namespace=<ts>` query that Node 25's stricter finalizeResolution rejects with
  // ERR_MODULE_NOT_FOUND. We fall back to tsx only when native import fails (older
  // Node without type stripping, or configs using syntax that needs transformation
  // like enums/namespaces).
  try {
    return await import(fileUrl);
  } catch (nativeError) {
    // Native import failed — try the tsx ESM API as a fallback transformer.
    let tsImport:
      | ((specifier: string, options: string | { parentURL: string }) => Promise<unknown>)
      | undefined;
    try {
      const tsxEsm = await import('tsx/esm/api');
      tsImport = tsxEsm.tsImport;
    } catch {
      // Both native import and tsx are unusable. Surface the actionable
      // "install tsx" guidance (the established behavior), chaining the native
      // error so the underlying load failure isn't lost.
      throw new ConfigError(
        'Failed to load config: `tsx` is required for loading TypeScript config files. ' +
          'Install it as a dev dependency: pnpm add -D tsx',
        { cause: nativeError },
      );
    }

    const parentURL = pathToFileURL(`${filePath}__parent__`).href;
    return tsImport(fileUrl, { parentURL });
  }
}

function resolveAbsolute(cwd: string, p: string): string {
  if (isAbsolute(p)) return p;
  return resolve(cwd, p);
}

/**
 * Validates that `resolvedPath` is contained inside `cwd`.
 * Throws `ConfigError` if the path escapes the project root (e.g. via `..`
 * traversal or an absolute path outside cwd).
 */
function assertInsideCwd(cwd: string, resolvedPath: string, fieldName: string): void {
  const rel = relative(cwd, resolvedPath);
  // relative() returns a path starting with '..' when the target is outside cwd,
  // and isAbsolute() catches platform edge-cases (e.g. Windows drive letters).
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new ConfigError(
      `\`${fieldName}\` must be inside the project cwd.\n  Resolved to: ${resolvedPath}\n  Project cwd: ${cwd}\nIf this is intentional, move the file inside your project directory.`,
    );
  }
}

/**
 * Resolve a {@link UserConfig} (e.g. `NestjsCodegenModule.forRoot()` options) into a
 * fully-defaulted {@link ResolvedConfig} — without reading a config file. Used by the
 * Nest module and any programmatic caller that already holds the config in memory.
 *
 * @param userConfig the raw user config (forRoot options minus module-only fields)
 * @param cwd project root used to resolve globs / outDir. Defaults to `process.cwd()`.
 */
export function resolveConfig(userConfig: UserConfigInput, cwd?: string): ResolvedConfig {
  return applyDefaults(userConfig, cwd ?? process.cwd());
}

/**
 * Loosened {@link UserConfig} where `validation` may be absent. Both config entry
 * points accept this shape and enforce `validation` at runtime (it throws a clear
 * {@link ConfigError} when missing) — letting callers like the Nest module pass
 * partial options without a compile-time `validation` requirement.
 */
type UserConfigInput = Omit<UserConfig, 'validation'> & {
  validation?: UserConfig['validation'];
};

/**
 * Input validation shared by both config entry points ({@link loadConfig} and
 * {@link resolveConfig}). Guards user-provided fields before defaults are applied so
 * the file path and the programmatic `forRoot()` path reject the same bad input.
 */
function validateUserConfig(userConfig: UserConfigInput): void {
  // `validation` is required — no adapter is bundled in core.
  if (userConfig.validation == null) {
    throw new ConfigError(
      'validation adapter is required — install @dudousxd/nestjs-codegen-zod and pass zodAdapter, or use @dudousxd/nestjs-codegen-valibot / -arktype',
    );
  }
  // `pages` is Inertia-only and optional — but if present, `glob` must be a string.
  if (userConfig.pages && typeof userConfig.pages.glob !== 'string') {
    throw new ConfigError(
      'Config validation failed: `pages.glob` must be a string when `pages` is set',
    );
  }
}

function applyDefaults(userConfig: UserConfigInput, cwd: string): ResolvedConfig {
  validateUserConfig(userConfig);

  const outDir = userConfig.codegen?.outDir
    ? resolveAbsolute(cwd, userConfig.codegen.outDir)
    : join(cwd, '.nestjs-codegen');

  const resolvedCwd = userConfig.codegen?.cwd ? resolveAbsolute(cwd, userConfig.codegen.cwd) : cwd;

  let app: ResolvedConfig['app'] = null;
  if (userConfig.app) {
    const resolvedEntry = resolveAbsolute(cwd, userConfig.app.moduleEntry);
    assertInsideCwd(cwd, resolvedEntry, 'app.moduleEntry');

    let resolvedTsconfig: string | null = null;
    if (userConfig.app.tsconfig) {
      resolvedTsconfig = resolveAbsolute(cwd, userConfig.app.tsconfig);
      assertInsideCwd(cwd, resolvedTsconfig, 'app.tsconfig');
    }

    app = {
      moduleEntry: resolvedEntry,
      tsconfig: resolvedTsconfig,
    };
  }

  return {
    debug: userConfig.debug ?? false,
    extensions: userConfig.extensions ?? [],
    // Non-null: validateUserConfig() above throws when `validation` is absent.
    validation: resolveAdapter(userConfig.validation as NonNullable<typeof userConfig.validation>),
    pages: userConfig.pages
      ? {
          glob: userConfig.pages.glob,
          propsExport: userConfig.pages.propsExport ?? 'ComponentProps',
          componentNameStrategy: userConfig.pages.componentNameStrategy ?? 'relative-no-ext',
        }
      : null,
    contracts: {
      glob: userConfig.contracts?.glob ?? 'src/**/*.controller.ts',
      debounceMs: userConfig.contracts?.debounceMs ?? 500,
    },
    scopes: userConfig.scopes ?? {},
    codegen: {
      outDir,
      cwd: resolvedCwd,
    },
    app,
    fetcher: userConfig.fetcher ?? null,
    serialization: userConfig.serialization ?? 'json',
    forms: {
      enabled: userConfig.forms?.enabled ?? true,
      watch: userConfig.forms?.watch ?? 'src/**/*.dto.ts',
      zodImport: userConfig.forms?.zodImport ?? 'zod',
    },
    openapi: {
      enabled: userConfig.openapi?.enabled ?? false,
      fileName: userConfig.openapi?.fileName ?? 'openapi.json',
      title: userConfig.openapi?.title ?? 'NestJS API',
      version: userConfig.openapi?.version ?? '1.0.0',
      description: userConfig.openapi?.description ?? null,
    },
    mocks: {
      enabled: userConfig.mocks?.enabled ?? false,
      fileName: userConfig.mocks?.fileName ?? 'mocks.ts',
      seed: userConfig.mocks?.seed ?? 1,
      baseUrl: userConfig.mocks?.baseUrl ?? '',
    },
    driftGuard: userConfig.driftGuard ?? true,
  };
}

export async function loadConfig(cwd?: string): Promise<ResolvedConfig> {
  const resolvedCwd = cwd ?? process.cwd();

  let configPath: string | undefined;
  for (const name of CONFIG_FILES) {
    const candidate = join(resolvedCwd, name);
    if (await fileExists(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (!configPath) {
    throw new ConfigError(
      `Config file not found in ${resolvedCwd} (looked for ${CONFIG_FILES.join(', ')})\nRun \`nestjs-codegen init\` to create a starter config.`,
    );
  }

  let mod: unknown;
  try {
    mod = await importTs(configPath);
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Failed to load config from ${configPath}`, { cause: err });
  }

  // tsImport returns a namespace module where `mod.default` is the module namespace object.
  // The actual `export default` value lives at `mod.default.default` (or `mod.default` for CJS interop).
  const modNs = (mod as Record<string, unknown>).default;
  const userConfig =
    modNs != null && typeof modNs === 'object' && 'default' in (modNs as object)
      ? ((modNs as Record<string, unknown>).default as UserConfig)
      : (modNs as UserConfig | undefined);

  if (!userConfig || typeof userConfig !== 'object') {
    throw new ConfigError(
      `Config file must have a default export. Did you forget \`export default defineConfig({...})\`? (${configPath})`,
    );
  }

  return applyDefaults(userConfig, resolvedCwd);
}
