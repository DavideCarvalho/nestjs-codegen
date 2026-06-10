import type { ValidationOption } from '../adapters/registry.js';
import type { ValidationAdapter } from '../adapters/types.js';
import type { CodegenExtension } from '../extension/types.js';

export interface UserConfig {
  /**
   * Codegen extensions, applied in order. Each may augment the route IR
   * (`transformRoutes`), contribute extra output files (`emitFiles`), and — once a
   * client layer is active — shape `api.ts`. Registered explicitly, e.g.
   * `extensions: [nestjsInertiaCodegen(), tanstackQuery()]`.
   */
  extensions?: CodegenExtension[];
  /**
   * Validation library for emitted `forms.ts` schemas. `'zod'` (bundled, default)
   * or an imported adapter instance (`valibotAdapter`/`arktypeAdapter`).
   * @default 'zod'
   */
  validation?: ValidationOption;
  /**
   * How `api.ts` issues mutations. `'inertia'` (default) uses the Inertia router;
   * `'fetcher'` uses the typed fetcher from `@dudousxd/nestjs-client` (no Inertia).
   * @default 'inertia'
   */
  mutationClient?: 'fetcher' | 'inertia';
  /**
   * Module the generated `api.ts` imports `queryOptions`/`mutationOptions` from.
   * Default `@tanstack/react-query` (it re-exports them — no need to install
   * `@tanstack/query-core` directly). Vue/Svelte/Solid users point this at their
   * own adapter, e.g. `@tanstack/vue-query`.
   * @default '@tanstack/react-query'
   */
  queryImport?: string;
  /**
   * Emit TanStack Query handles. `false` (default): each endpoint is a plain typed
   * fetch — `api.users.show({ params }) → Promise`. `true`: the call returns a handle
   * — `api.users.show({ params }).queryOptions()` / `.mutationOptions()`.
   * @default false
   */
  query?: boolean;
  /** Inertia page discovery. Omit when you don't use Inertia. */
  pages?: {
    glob: string;
    propsExport?: string;
    componentNameStrategy?: 'relative-no-ext' | 'kebab' | ((path: string) => string);
  };
  contracts?: {
    /** Glob pattern (relative to cwd) for controller files. Default: `'src/**\/\*.controller.ts'` */
    glob?: string;
    /** Debounce delay in ms before re-running route discovery. Default: `500` */
    debounceMs?: number;
  };
  scopes?: Record<string, ScopeConfig>;
  codegen?: {
    outDir?: string;
    cwd?: string;
  };
  app?: {
    moduleEntry: string;
    tsconfig?: string;
  } | null;
  /**
   * Custom fetcher configuration. When `importPath` is set, the codegen
   * imports `fetcher` from that path instead of generating `createFetcher()`.
   * This lets users configure baseUrl, headers, plugins (e.g. superjson).
   *
   * @example
   * // nestjs-inertia.config.ts
   * fetcher: { importPath: '~/lib/api' }
   *
   * // inertia/lib/api.ts
   * import { createFetcher } from '@dudousxd/nestjs-inertia-client';
   * export const fetcher = createFetcher({ baseUrl: '/api' });
   */
  fetcher?: {
    importPath: string;
  };
  /**
   * Typed-form schema emit (`forms.ts`). Re-exports / translates contract and
   * class-validator-decorated DTO schemas into zod schemas for client-side
   * validation.
   */
  forms?: {
    /** Emit `forms.ts`. Default: `true` (when ≥1 validatable body exists). */
    enabled?: boolean;
    /** DTO glob to watch for form-schema regen. Default: `'src/**\/\*.dto.ts'`. */
    watch?: string;
    /** Module specifier for the `z` import. Default: `'zod'`. */
    zodImport?: string;
  };
}

export interface ScopeConfig {
  glob: string;
  prefix?: string;
}

export interface ResolvedPagesConfig {
  glob: string;
  propsExport: string;
  componentNameStrategy: 'relative-no-ext' | 'kebab' | ((path: string) => string);
}

export interface ResolvedContractsConfig {
  /** Glob pattern relative to `codegen.cwd` for watching controller files. */
  glob: string;
  /** Debounce delay in ms before re-running route discovery. */
  debounceMs: number;
}

export interface ResolvedCodegenConfig {
  outDir: string;
  cwd: string;
}

export interface ResolvedAppConfig {
  moduleEntry: string;
  tsconfig: string | null;
}

export interface ResolvedFormsConfig {
  enabled: boolean;
  watch: string;
  zodImport: string;
}

export interface ResolvedConfig {
  extensions: CodegenExtension[];
  validation: ValidationAdapter;
  mutationClient: 'fetcher' | 'inertia';
  queryImport: string;
  query: boolean;
  pages: ResolvedPagesConfig | null;
  contracts: ResolvedContractsConfig;
  scopes: Record<string, ScopeConfig>;
  codegen: ResolvedCodegenConfig;
  app: ResolvedAppConfig | null;
  fetcher: { importPath: string } | null;
  forms: ResolvedFormsConfig;
}
