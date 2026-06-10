import type { SchemaModule, SchemaNode } from '../ir/schema-node.js';

/** Signals to an adapter what it must import to render the current output. */
export interface AdapterUsage {
  /** Whether any schema is rendered at all (drives import emission). */
  used: boolean;
}

export interface RenderContext {
  /** Hoisted named schemas being emitted alongside the root. */
  named: Map<string, SchemaNode>;
}

export interface RenderedModule {
  /** Root schema source text, e.g. `"z.object({ email: z.string().email() })"`. */
  schemaText: string;
  /** name → schema source text, hoisted above the parent. */
  namedNestedSchemas: Map<string, string>;
  warnings: string[];
}

/**
 * Renders the neutral {@link SchemaNode} IR into a concrete validation lib's
 * source text. Designed around the Standard Schema spec: a new lib is added by
 * implementing `render`/`renderModule` + `importStatements`.
 */
export interface ValidationAdapter {
  /** 'zod' | 'valibot' | 'arktype'. */
  name: string;
  /** Import lines required for any rendered text (e.g. `import { z } from 'zod'`). */
  importStatements(usage: AdapterUsage): string[];
  /** Render a single node to this lib's source text. */
  render(node: SchemaNode, ctx: RenderContext): string;
  /** Render a full module (root + hoisted named) to text. */
  renderModule(mod: SchemaModule): RenderedModule;
}
