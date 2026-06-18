/**
 * Converts the neutral {@link SchemaNode} / {@link SchemaModule} IR into a
 * JSON Schema object compatible with the OpenAPI 3.1 schema dialect (which *is*
 * JSON Schema 2020-12). This is the shared lowering used by both the OpenAPI 3.1
 * exporter (`emit/emit-openapi.ts`) and the MSW+faker mock generator
 * (`emit/emit-msw.ts`) — they consume the same JSON Schema so the spec and the
 * mocks can never disagree about a route's shape.
 *
 * Design notes:
 *  - `enum` literals and `literal.raw` are verbatim TS source texts (quote style
 *    preserved, produced by ts-morph `getText()`), e.g. `'active'`, `42`, `true`,
 *    `null`. They are parsed back into real JSON values by {@link parseLiteral}.
 *  - Named schemas (the `named` map of a `SchemaModule`) are lowered into
 *    `components/schemas` and referenced via `$ref`, so recursion (`lazyRef`) and
 *    sharing produce real `$ref` cycles rather than infinite inlining.
 *  - `optional` only affects an *object field's* membership in `required`; a bare
 *    optional widens the type with `null` (the closest JSON Schema analog).
 */
import type { SchemaModule, SchemaNode } from './schema-node.js';

/** A minimal JSON Schema object (OpenAPI 3.1 dialect). Open-ended on purpose. */
export type JsonSchema = {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  discriminator?: { propertyName: string };
  $ref?: string;
  description?: string;
  nullable?: boolean; // not used in 3.1 (kept off by default); 3.1 uses type arrays
  [key: string]: unknown;
};

export interface JsonSchemaContext {
  /** Prefix for `$ref` targets. Default `'#/components/schemas/'`. */
  refPrefix: string;
}

const DEFAULT_CTX: JsonSchemaContext = { refPrefix: '#/components/schemas/' };

/**
 * Parse a verbatim TS literal source text into a real JSON value.
 * Handles single/double-quoted strings, numbers, booleans and null. Anything
 * unrecognized falls back to the trimmed string form.
 */
export function parseLiteral(raw: string): unknown {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  // Quoted string (single, double, or backtick without interpolation).
  const q = t[0];
  if ((q === "'" || q === '"' || q === '`') && t[t.length - 1] === q) {
    return t
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\`/g, '`')
      .replace(/\\\\/g, '\\');
  }
  // Numeric literal.
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    return Number(t);
  }
  return t;
}

/** Pick the narrowest JSON Schema `type` for a set of parsed literals. */
function literalsType(values: unknown[]): string | undefined {
  const types = new Set(values.map((v) => (v === null ? 'null' : typeof v)));
  if (types.size === 1) {
    const only = [...types][0];
    if (only === 'string') return 'string';
    if (only === 'number') return 'number';
    if (only === 'boolean') return 'boolean';
  }
  return undefined;
}

function convert(node: SchemaNode, ctx: JsonSchemaContext): JsonSchema {
  switch (node.kind) {
    case 'string': {
      const out: JsonSchema = { type: 'string' };
      for (const c of node.checks) {
        if (c.check === 'email') out.format = 'email';
        else if (c.check === 'url') out.format = 'uri';
        else if (c.check === 'uuid') out.format = 'uuid';
        else if (c.check === 'min') out.minLength = Number(c.value);
        else if (c.check === 'max') out.maxLength = Number(c.value);
        else if (c.check === 'regex') {
          // Strip leading/trailing slashes and trailing flags from a regex literal.
          const m = /^\/(.*)\/[a-z]*$/.exec(c.pattern);
          out.pattern = m ? m[1] : c.pattern;
        }
      }
      return out;
    }
    case 'number': {
      const out: JsonSchema = { type: 'number' };
      for (const c of node.checks) {
        if (c.check === 'int') out.type = 'integer';
        else if (c.check === 'min') out.minimum = Number(c.value);
        else if (c.check === 'max') out.maximum = Number(c.value);
        else if (c.check === 'positive') out.exclusiveMinimum = 0;
        else if (c.check === 'negative') out.exclusiveMaximum = 0;
      }
      return out;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      // JSON has no date type; OpenAPI represents it as a date-time string.
      return { type: 'string', format: 'date-time' };
    case 'unknown':
      return node.note ? { description: node.note } : {};
    case 'instanceof':
      return { type: 'object', description: `instanceof ${node.ctor}` };
    case 'enum': {
      const values = node.literals.map(parseLiteral);
      const t = literalsType(values);
      const out: JsonSchema = { enum: values };
      if (t) out.type = t;
      return out;
    }
    case 'literal': {
      const value = parseLiteral(node.raw);
      const out: JsonSchema = { const: value };
      const t = literalsType([value]);
      if (t) out.type = t;
      return out;
    }
    case 'union': {
      const options = node.options.map((o) => convert(o, ctx));
      const out: JsonSchema = { oneOf: options };
      if (node.discriminator) {
        out.discriminator = { propertyName: node.discriminator };
      }
      return out;
    }
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const f of node.fields) {
        if (f.value.kind === 'optional') {
          properties[f.key] = convert(f.value.inner, ctx);
        } else {
          properties[f.key] = convert(f.value, ctx);
          required.push(f.key);
        }
      }
      const out: JsonSchema = { type: 'object', properties };
      if (required.length > 0) out.required = required;
      out.additionalProperties = node.passthrough;
      return out;
    }
    case 'array':
      return { type: 'array', items: convert(node.element, ctx) };
    case 'optional':
      // A bare optional (not on an object key) — widen with null.
      return widenNullable(convert(node.inner, ctx));
    case 'ref':
    case 'lazyRef':
      return { $ref: `${ctx.refPrefix}${node.name}` };
    case 'annotated':
      return convert(node.inner, ctx);
  }
}

/** Add `null` to a schema's type (OpenAPI 3.1 style: a type-array). */
function widenNullable(schema: JsonSchema): JsonSchema {
  if (schema.$ref) {
    // Can't add null to a bare $ref in 3.1 without anyOf — wrap it.
    return { anyOf: [schema, { type: 'null' }] };
  }
  if (typeof schema.type === 'string') {
    return { ...schema, type: [schema.type, 'null'] };
  }
  if (Array.isArray(schema.type)) {
    return schema.type.includes('null') ? schema : { ...schema, type: [...schema.type, 'null'] };
  }
  return { anyOf: [schema, { type: 'null' }] };
}

/** Convert a single {@link SchemaNode} to a JSON Schema object. */
export function schemaNodeToJsonSchema(
  node: SchemaNode,
  ctx: JsonSchemaContext = DEFAULT_CTX,
): JsonSchema {
  return convert(node, ctx);
}

/**
 * Lower an entire {@link SchemaModule} to a `{ root, named }` pair of JSON
 * Schemas. The `named` map becomes `components/schemas` entries; `root` is the
 * route-level schema that references them via `$ref`.
 */
export function schemaModuleToJsonSchema(
  mod: SchemaModule,
  ctx: JsonSchemaContext = DEFAULT_CTX,
): { root: JsonSchema; named: Record<string, JsonSchema> } {
  const named: Record<string, JsonSchema> = {};
  for (const [name, node] of mod.named) {
    named[name] = convert(node, ctx);
  }
  return { root: convert(mod.root, ctx), named };
}
