import { ConfigError } from '../exceptions.js';
import type { ValidationAdapter } from './types.js';

/**
 * A validation adapter instance. No adapter is bundled in core — import one from
 * its own package (`zodAdapter`/`valibotAdapter`/`arktypeAdapter`) or pass a custom
 * object. String shortcuts (`'zod'` etc.) are intentionally not part of this type:
 * they always threw at runtime, so the type guides you to an imported instance.
 */
export type ValidationOption = ValidationAdapter;

/**
 * Resolve a `validation` config value to a {@link ValidationAdapter}. No adapter is
 * bundled in core — the zod/valibot/arktype adapters ship as their own packages.
 * Import the adapter instance and pass it directly (it passes through here). A
 * custom adapter object also passes through.
 *
 * The parameter also accepts a `string` so the runtime guard still fires for JS
 * callers / untyped configs that pass a removed string shortcut (e.g. `'zod'`):
 * those throw a helpful error pointing at the adapter package. TypeScript users
 * are steered away from strings by the narrowed {@link ValidationOption} type.
 *
 * @example
 * import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
 * defineConfig({ validation: zodAdapter });
 */
export function resolveAdapter(option: ValidationOption | string): ValidationAdapter {
  if (typeof option !== 'string') return option;
  const pkg = `@dudousxd/nestjs-codegen-${option}`;
  const named = `${option}Adapter`;
  throw new ConfigError(
    `Validation adapter "${option}" is not bundled in core. Install ${pkg} and pass the adapter instance instead of the string:\n\n  import { ${named} } from '${pkg}';\n  defineConfig({ validation: ${named} });`,
  );
}
