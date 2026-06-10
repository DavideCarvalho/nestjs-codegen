import { resolveAdapter } from '../adapters/registry.js';
import type { CodegenConfig, ResolvedConfig } from './types.js';

/** Identity helper for typed config authoring. */
export function defineConfig(config: CodegenConfig): CodegenConfig {
  return config;
}

/** Apply defaults and resolve the validation adapter. */
export function resolveConfig(config: CodegenConfig): ResolvedConfig {
  return {
    outDir: config.outDir,
    validation: resolveAdapter(config.validation ?? 'zod'),
    query: config.query ?? false,
    transformer: config.transformer ?? false,
    mutationClient: config.mutationClient ?? 'fetcher',
    fetcherModule: config.fetcherModule ?? './fetcher.js',
  };
}
