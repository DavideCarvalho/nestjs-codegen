import { ConfigError } from '../exceptions.js';
import type { ValidationAdapter } from './types.js';

/** A built-in adapter name or a custom adapter instance. */
export type ValidationOption = 'zod' | 'valibot' | 'arktype' | ValidationAdapter;

/**
 * Resolve a `validation` config value to a {@link ValidationAdapter}. No adapter is
 * bundled in core — the zod/valibot/arktype adapters ship as their own packages.
 * Import the adapter instance and pass it directly (it passes through here). A
 * custom adapter object also passes through.
 *
 * @example
 * import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
 * defineConfig({ validation: zodAdapter });
 */
export function resolveAdapter(option: ValidationOption): ValidationAdapter {
  if (typeof option !== 'string') return option;
  const pkg = `@dudousxd/nestjs-codegen-${option}`;
  const named = `${option}Adapter`;
  throw new ConfigError(
    `Validation adapter "${option}" is not bundled in core. Install ${pkg} and pass the adapter instance instead of the string:\n\n  import { ${named} } from '${pkg}';\n  defineConfig({ validation: ${named} });`,
  );
}
