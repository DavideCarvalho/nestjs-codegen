/**
 * Renders the neutral {@link SchemaNode} IR to a TypeScript *type* expression
 * (not a validation-lib schema). Used to synthesize the hoisted structural type
 * that annotates a recursive zod/valibot const, breaking the implicit-any
 * inference cycle (`type X = {...}` + `const XSchema: z.ZodType<X> = ...`).
 *
 * References to other named schemas resolve two ways:
 *   - a `ref`/`lazyRef` to a *recursive* schema → its type-alias name (so the
 *     emitted `type` aliases reference each other, terminating the recursion);
 *   - a `ref` to a *non-recursive* schema → inlined structurally (keeps the set
 *     of emitted `type` aliases limited to exactly the recursive cluster).
 * Inlining always terminates: every reference cycle passes through a recursive
 * name, which is rendered by alias rather than expanded.
 */
import type { SchemaNode } from './schema-node.js';

export interface TsTypeContext {
  /** All hoisted named schemas (for inlining non-recursive refs). */
  named: Map<string, SchemaNode>;
  /** Names that are genuinely recursive (rendered by alias, never inlined). */
  recursive: Set<string>;
  /** schema const name (e.g. `ColumnFilterSchema`) → TS type-alias name. */
  typeNameFor: (schemaName: string) => string;
}

/** Valid JS identifier → bare key, else quoted. */
function tsKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

export function renderTsType(node: SchemaNode, ctx: TsTypeContext): string {
  switch (node.kind) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'unknown':
      return 'unknown';
    case 'instanceof':
      return node.ctor;
    case 'enum':
      return node.literals.join(' | ');
    case 'literal':
      return node.raw;
    case 'union':
      return node.options.map((o) => renderTsType(o, ctx)).join(' | ');
    case 'array':
      return `Array<${renderTsType(node.element, ctx)}>`;
    case 'optional':
      // A bare optional (not on an object key) widens with `undefined`.
      return `${renderTsType(node.inner, ctx)} | undefined`;
    case 'annotated':
      return renderTsType(node.inner, ctx);
    case 'object': {
      if (node.fields.length === 0) return node.passthrough ? 'Record<string, unknown>' : '{}';
      const inner = node.fields
        .map((f) => {
          if (f.value.kind === 'optional') {
            return `${tsKey(f.key)}?: ${renderTsType(f.value.inner, ctx)}`;
          }
          return `${tsKey(f.key)}: ${renderTsType(f.value, ctx)}`;
        })
        .join('; ');
      return `{ ${inner} }`;
    }
    case 'ref':
    case 'lazyRef': {
      if (ctx.recursive.has(node.name)) return ctx.typeNameFor(node.name);
      const target = ctx.named.get(node.name);
      return target ? renderTsType(target, ctx) : 'unknown';
    }
  }
}
