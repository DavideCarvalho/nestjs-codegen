import { ConfigError } from '../exceptions.js';
import type { ValidationAdapter } from './types.js';
import { zodAdapter } from './zod.js';

/** A built-in adapter name or a custom adapter instance. */
export type ValidationOption = 'zod' | 'valibot' | 'arktype' | ValidationAdapter;

/**
 * Resolve a `validation` config value to a {@link ValidationAdapter}. Only `zod`
 * ships in-tree today; `valibot`/`arktype` resolve once their adapter packages
 * are installed (a later milestone). A custom adapter object passes through.
 */
export function resolveAdapter(option: ValidationOption): ValidationAdapter {
  if (typeof option !== 'string') return option;
  if (option === 'zod') return zodAdapter;
  throw new ConfigError(
    `Validation adapter "${option}" is not yet available. Only "zod" ships today; valibot and arktype adapters arrive in a later milestone.`,
  );
}
