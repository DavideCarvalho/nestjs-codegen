import { renderTsType } from '../ir/render-ts-type.js';
import type { SchemaModule, SchemaNode } from '../ir/schema-node.js';
import type { RenderContext, RenderedModule } from './types.js';

/** Schema const name → hoisted TS type-alias name (`ColumnFilterSchema` → `ColumnFilter`). */
export function typeNameFor(schemaName: string): string {
  return schemaName.replace(/Schema(_\d+)?$/, '$1');
}

/** Valid JS identifier → bare key, else quoted. */
export function toObjectKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

export interface ChainModuleRendererOptions {
  /** The adapter's node renderer (used for both the root and each hoisted named schema). */
  render(node: SchemaNode, ctx: RenderContext): string;
  /**
   * Const type annotation for a recursive schema, e.g. `z.ZodType<ColumnFilter>`
   * or `v.GenericSchema<ColumnFilter>`, emitted as `const <name>: <annotation> = ...`
   * to break the implicit-any self-reference cycle.
   */
  recursiveAnnotation(typeName: string): string;
}

/**
 * Builds the `renderModule` for a method-chain / pipe-style adapter (zod, valibot):
 * render the root and every hoisted named schema, and for each recursive schema emit
 * a structural `type` alias plus a const annotation. The only thing these adapters
 * differ on is the annotation text, supplied via {@link ChainModuleRendererOptions.recursiveAnnotation};
 * everything else (the alias-name derivation, the recursive-set handling, the
 * `renderTsType` lowering) is identical. arktype does not use this — its module
 * rendering degrades mutually-recursive cycles and emits no type aliases.
 */
export function createChainModuleRenderer(
  opts: ChainModuleRendererOptions,
): (mod: SchemaModule) => RenderedModule {
  const { render, recursiveAnnotation } = opts;
  return (mod) => {
    const ctx: RenderContext = { named: mod.named };
    const recursive = mod.recursive ?? new Set<string>();
    const tctx = { named: mod.named, recursive, typeNameFor };
    const namedNestedSchemas = new Map<string, string>();
    const namedTypeAliases = new Map<string, string>();
    const namedAnnotations = new Map<string, string>();
    for (const [name, node] of mod.named) {
      namedNestedSchemas.set(name, render(node, ctx));
      if (recursive.has(name)) {
        const typeName = typeNameFor(name);
        namedTypeAliases.set(name, `type ${typeName} = ${renderTsType(node, tctx)}`);
        namedAnnotations.set(name, recursiveAnnotation(typeName));
      }
    }
    return {
      schemaText: render(mod.root, ctx),
      namedNestedSchemas,
      namedTypeAliases,
      namedAnnotations,
      warnings: mod.warnings,
    };
  };
}
