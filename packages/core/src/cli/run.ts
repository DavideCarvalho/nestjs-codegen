import type { CodegenConfig } from '../config/types.js';
import { discoverRoutes } from '../discovery/discover-controllers.js';
import { type GenerateResult, generate } from '../generate.js';

export interface RunOptions extends CodegenConfig {
  /** Controller file globs/paths to scan, e.g. `['src/**\/*.controller.ts']`. */
  controllers: string[];
  /** tsconfig path used to build the discovery Project. */
  tsConfigPath?: string;
}

/**
 * End-to-end codegen pass: discover routes from NestJS controllers, then emit
 * `routes.ts`/`api.ts`/`forms.ts`. The thin CLI wraps this; it is also directly
 * usable from build scripts.
 */
export async function runCodegen(options: RunOptions): Promise<GenerateResult> {
  const { controllers, tsConfigPath, ...config } = options;
  const discoverArg: { files: string[]; tsConfigPath?: string } = { files: controllers };
  if (tsConfigPath !== undefined) discoverArg.tsConfigPath = tsConfigPath;
  const routes = discoverRoutes(discoverArg);
  return generate(routes, config);
}
