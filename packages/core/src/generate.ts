import { resolveConfig } from './config/define-config.js';
import type { CodegenConfig } from './config/types.js';
import type { RouteDescriptor } from './discovery/route-model.js';
import { emitApi } from './emit/emit-api.js';
import { emitForms } from './emit/emit-forms.js';
import { emitRoutes } from './emit/emit-routes.js';

export interface GenerateResult {
  routes: number;
  forms: boolean;
}

/**
 * Run one codegen pass from a discovered route model: writes `routes.ts`,
 * `api.ts`, and (when any contract has a body/query schema) `forms.ts`.
 * Discovery (NestJS controllers → RouteDescriptor[]) is the caller's job.
 */
export async function generate(
  routes: RouteDescriptor[],
  config: CodegenConfig,
): Promise<GenerateResult> {
  const resolved = resolveConfig(config);
  await emitRoutes(routes, resolved.outDir);
  await emitApi(routes, resolved);
  const forms = await emitForms(routes, resolved);
  return { routes: routes.length, forms };
}
