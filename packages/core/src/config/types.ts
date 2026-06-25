import type { ValidationOption } from '../adapters/registry.js';
import type { ValidationAdapter } from '../adapters/types.js';
import type { CodegenExtension } from '../extension/types.js';

export interface UserConfig {
  /**
   * Print schema-translation advisories to the terminal (e.g. "@X is not
   * translatable to a client validation schema", "T is a recursive type"). These
   * are always preserved in generated output as `// warning:` comments regardless;
   * this only controls the duplicate terminal chatter, which is off by default.
   *
   * @default false
   */
  debug?: boolean;
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
   * How response payloads are deserialized on the client, which determines the
   * generated `response` type shape.
   *
   * - `'json'` (default): responses cross the wire as plain JSON, so the
   *   generated type is wrapped in `Jsonify<...>` (e.g. `Date` → `string`).
   * - `'superjson'`: responses are revived (Dates/Maps/Sets restored), so the
   *   raw controller return type is emitted unchanged.
   *
   * @default 'json'
   */
  serialization?: 'json' | 'superjson';
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
  /**
   * OpenAPI 3.1 spec export (`openapi.json`). Opt-in: omit (or `enabled: false`)
   * to skip. Lowers the discovered routes + validation IR into a valid OpenAPI
   * 3.1 document for ecosystem interop (consume/publish a spec).
   */
  openapi?: {
    /** Emit `openapi.json`. Default: `false`. */
    enabled?: boolean;
    /** Output file name within `outDir`. Default: `'openapi.json'`. */
    fileName?: string;
    /** `info.title`. Default: `'NestJS API'`. */
    title?: string;
    /** `info.version`. Default: `'1.0.0'`. */
    version?: string;
    /** `info.description`. */
    description?: string;
  };
  /**
   * MSW + faker mock handler generation (`mocks.ts`). Opt-in: omit (or
   * `enabled: false`) to skip. Generates Mock Service Worker handlers that return
   * faker-style data matching each route's response schema.
   */
  mocks?: {
    /** Emit `mocks.ts`. Default: `false`. */
    enabled?: boolean;
    /** Output file name within `outDir`. Default: `'mocks.ts'`. */
    fileName?: string;
    /** Deterministic seed for generated mock data. Default: `1`. */
    seed?: number;
    /** Base URL prepended to handler paths. Default: `''` (relative paths). */
    baseUrl?: string;
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

/** How response payloads are deserialized on the client. */
export type SerializationMode = 'json' | 'superjson';

export interface ResolvedAppConfig {
  moduleEntry: string;
  tsconfig: string | null;
}

export interface ResolvedFormsConfig {
  enabled: boolean;
  watch: string;
  zodImport: string;
}

export interface ResolvedOpenApiConfig {
  enabled: boolean;
  fileName: string;
  title: string;
  version: string;
  description: string | null;
}

export interface ResolvedMocksConfig {
  enabled: boolean;
  fileName: string;
  seed: number;
  baseUrl: string;
}

export interface ResolvedConfig {
  debug: boolean;
  extensions: CodegenExtension[];
  validation: ValidationAdapter;
  pages: ResolvedPagesConfig | null;
  contracts: ResolvedContractsConfig;
  scopes: Record<string, ScopeConfig>;
  codegen: ResolvedCodegenConfig;
  app: ResolvedAppConfig | null;
  fetcher: { importPath: string } | null;
  serialization: SerializationMode;
  forms: ResolvedFormsConfig;
  openapi: ResolvedOpenApiConfig;
  mocks: ResolvedMocksConfig;
}
