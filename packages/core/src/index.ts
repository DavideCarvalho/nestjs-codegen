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

export { ConfigError, CodegenError } from './exceptions.js';
