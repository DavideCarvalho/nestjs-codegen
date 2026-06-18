export const VERSION = '0.4.0';

// Codegen pipeline (migrated from nestjs-inertia)
export { defineConfig } from './config/define-config.js';
export { loadConfig, resolveConfig } from './config/load-config.js';
export type { UserConfig, ResolvedConfig, ScopeConfig } from './config/types.js';
export { ConfigError, CodegenError } from './exceptions.js';

export { generate } from './generate.js';
export { watch } from './watch/watcher.js';
export type { Watcher } from './watch/watcher.js';
export { acquireLock } from './watch/lock-file.js';

// Validation IR + pluggable adapters
export type {
  SchemaModule,
  SchemaNode,
  StringCheck,
  NumberCheck,
} from './ir/schema-node.js';
export { renderTsType } from './ir/render-ts-type.js';
export type { TsTypeContext } from './ir/render-ts-type.js';
export type {
  ValidationAdapter,
  AdapterUsage,
  RenderContext,
  RenderedModule,
} from './adapters/types.js';
export { resolveAdapter } from './adapters/registry.js';
export type { ValidationOption } from './adapters/registry.js';

// class-validator DTO → SchemaModule IR (consumed by the validation adapters)
export { extractSchemaFromDto } from './discovery/dto-to-ir.js';

// Discovery + emit (programmatic API)
export type {
  RouteDescriptor,
  ContractDescriptor,
  ContractSource,
  ControllerRef,
  TypeRef,
} from './discovery/types.js';
export { emitForms } from './emit/emit-forms.js';
export { emitApi } from './emit/emit-api.js';
export { emitRoutes } from './emit/emit-routes.js';
export { emitOpenApi, buildOpenApiSpec } from './emit/emit-openapi.js';
export type {
  OpenApiDocument,
  OpenApiEmitOptions,
  OpenApiInfo,
} from './emit/emit-openapi.js';
export { emitMocks, buildMocksFile } from './emit/emit-mocks.js';
export type { MocksEmitOptions } from './emit/emit-mocks.js';
export {
  schemaNodeToJsonSchema,
  schemaModuleToJsonSchema,
} from './ir/schema-node-to-json-schema.js';
export type { JsonSchema } from './ir/schema-node-to-json-schema.js';
export { discoverContractsFast } from './discovery/contracts-fast.js';
export type { FastDiscoveryOptions } from './discovery/contracts-fast.js';
