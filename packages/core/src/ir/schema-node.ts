/**
 * Neutral validation IR. Produced by `dto-to-ir` (class-validator AST → IR) and,
 * later, by parsing `defineContract` zod schemas back into the same shape. A
 * `ValidationAdapter` renders a `SchemaNode` to source text in a concrete lib
 * (zod today; valibot/arktype later).
 *
 * Design note: a few nodes (`raw`, `annotated`, message-carrying checks) preserve
 * source-level detail so the zod adapter can reproduce the previous emitter's
 * output byte-for-byte. Adapters for other libs read the semantic fields and may
 * normalize incidental formatting (quote style, comment wording).
 */

/** A `{ message: '...' }` options arg, stored as the verbatim source text (e.g. `'Bad email'`). */
export type MessageRaw = string;

export type StringCheck =
  | { check: 'email'; messageRaw?: MessageRaw }
  | { check: 'url'; messageRaw?: MessageRaw }
  | { check: 'uuid'; messageRaw?: MessageRaw }
  | { check: 'regex'; pattern: string } // full regex literal text incl. slashes + flags
  | { check: 'min'; value: string } // raw numeric source text
  | { check: 'max'; value: string };

export type NumberCheck =
  | { check: 'int' }
  | { check: 'min'; value: string }
  | { check: 'max'; value: string }
  | { check: 'positive' }
  | { check: 'negative' };

export type SchemaNode =
  | { kind: 'string'; checks: StringCheck[] }
  | { kind: 'number'; checks: NumberCheck[] }
  | { kind: 'boolean' }
  | { kind: 'date' }
  /** Unknown/opaque value. `note`, when present, becomes a trailing comment
   * (e.g. recursion degradation or unresolvable-enum fallback reasons). Kept
   * neutral so each adapter renders its own lib's `unknown` + comment. */
  | { kind: 'unknown'; note?: string }
  | { kind: 'instanceof'; ctor: string }
  /** Members are verbatim literal source texts (quote style preserved). */
  | { kind: 'enum'; literals: string[] }
  | { kind: 'literal'; raw: string }
  /**
   * A union of schemas. When `discriminator` is set (the shared literal property
   * name, e.g. `'kind'`), this is a *discriminated* union: adapters that support
   * it emit a fast tagged-union form (zod `discriminatedUnion`, valibot `variant`).
   * Plain unions leave `discriminator` undefined.
   */
  | { kind: 'union'; options: SchemaNode[]; discriminator?: string }
  | { kind: 'object'; fields: Array<{ key: string; value: SchemaNode }>; passthrough: boolean }
  | { kind: 'array'; element: SchemaNode }
  | { kind: 'optional'; inner: SchemaNode }
  /** Reference to a hoisted named schema (emitted in `SchemaModule.named`). */
  | { kind: 'ref'; name: string }
  /** Lazy reference to a hoisted named schema (recursion site). */
  | { kind: 'lazyRef'; name: string }
  /** Wraps a node with trailing comments for unmappable decorators (by name). */
  | { kind: 'annotated'; inner: SchemaNode; unmappable: string[] };

/** A root schema plus hoisted named (nested/recursive) schemas. */
export interface SchemaModule {
  root: SchemaNode;
  named: Map<string, SchemaNode>;
  warnings: string[];
  /**
   * Names (keys of {@link named}) that are genuinely self/mutually recursive,
   * i.e. reachable from themselves through a `lazyRef` back-edge. Adapters use
   * this to break the TypeScript inference cycle (annotated const + hoisted
   * structural type for zod/valibot; `this`/degrade for arktype). Absent or
   * empty means no recursion.
   */
  recursive?: Set<string>;
}
