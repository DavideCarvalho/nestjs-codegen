export const VERSION = '0.1.0';

// Validation IR
export type {
  SchemaModule,
  SchemaNode,
  StringCheck,
  NumberCheck,
} from './ir/schema-node.js';

// Validation adapters
export type {
  ValidationAdapter,
  AdapterUsage,
  RenderContext,
  RenderedModule,
} from './adapters/types.js';
export { zodAdapter } from './adapters/zod.js';
export { resolveAdapter } from './adapters/registry.js';
export type { ValidationOption } from './adapters/registry.js';

// Discovery: class-validator DTO → SchemaModule IR
export { extractSchemaFromDto } from './discovery/dto-to-ir.js';

// Route model
export type {
  RouteDescriptor,
  RouteContract,
  HttpMethod,
} from './discovery/route-model.js';

// Config
export { defineConfig, resolveConfig } from './config/define-config.js';
export type { CodegenConfig, ResolvedConfig } from './config/types.js';

// Emit
export { generate } from './generate.js';
export type { GenerateResult } from './generate.js';
export { emitRoutes, buildRoutesFile } from './emit/emit-routes.js';
export { emitApi, buildApiFile } from './emit/emit-api.js';
export { emitForms } from './emit/emit-forms.js';

export { ConfigError, CodegenError } from './exceptions.js';
