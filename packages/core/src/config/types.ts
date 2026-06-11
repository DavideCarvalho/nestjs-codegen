import type { ValidationOption } from '../adapters/registry.js';
import type { ValidationAdapter } from '../adapters/types.js';
import type { CodegenExtension } from '../extension/types.js';

export interface UserConfig {
  /**
   * Codegen extensions, applied in order. Each may augment the route IR
   * (`transformRoutes`), contribute extra output files (`emitFiles`), and — once a
   * client layer is active — shape `api.ts`. Registered explicitly, e.g.
   * `extensions: [clientCodegen(), tanstackQuery()]`.
   */
  extensions?: CodegenExtension[];
  /**
   * Validation library for emitted `forms.ts` schemas. Required — pass an imported
   * adapter instance, e.g. `zodAdapter` from `@dudousxd/nestjs-codegen-zod`, or
   * `valibotAdapter`/`arktypeAdapter` from their packages.
   */
  validation: ValidationOption;
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
   * // nestjs-codegen.config.ts
   * fetcher: { importPath: '~/lib/api' }
   *
   * // src/lib/api.ts
   * import { createFetcher } from '@dudousxd/nestjs-client';
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
  pages: ResolvedPagesConfig | null;
  contracts: ResolvedContractsConfig;
  scopes: Record<string, ScopeConfig>;
  codegen: ResolvedCodegenConfig;
  app: ResolvedAppConfig | null;
  fetcher: { importPath: string } | null;
  forms: ResolvedFormsConfig;
}
