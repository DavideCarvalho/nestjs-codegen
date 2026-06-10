import type { ValidationOption } from '../adapters/registry.js';
import type { ValidationAdapter } from '../adapters/types.js';

export interface CodegenConfig {
  /** Output directory for generated files. */
  outDir: string;
  /** Validation lib for emitted schemas. Default `'zod'`. */
  validation?: ValidationOption;
  /** Emit framework-agnostic TanStack `queryOptions`/`mutationOptions`. Default `false`. */
  query?: boolean;
  /** Payload transformer wired into the runtime fetcher. Default `false`. */
  transformer?: 'superjson' | false;
  /** How mutations are issued. `'fetcher'` (plain) or `'inertia'` (set by the Inertia preset). Default `'fetcher'`. */
  mutationClient?: 'fetcher' | 'inertia';
  /** Module the generated `fetcher` instance is imported from. Default `'./fetcher.js'`. */
  fetcherModule?: string;
}

export interface ResolvedConfig {
  outDir: string;
  validation: ValidationAdapter;
  query: boolean;
  transformer: 'superjson' | false;
  mutationClient: 'fetcher' | 'inertia';
  fetcherModule: string;
}
