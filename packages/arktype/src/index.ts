import type {
  AdapterUsage,
  NumberCheck,
  RenderContext,
  RenderedModule,
  SchemaModule,
  SchemaNode,
  StringCheck,
  ValidationAdapter,
} from '@dudousxd/nestjs-codegen';

/** Valid JS identifier → bare key, else quoted. arktype optional keys get a `?` suffix. */
function objectKey(name: string, optional: boolean): string {
  const key = optional ? `${name}?` : name;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !optional ? key : JSON.stringify(key);
}

/** Normalize a literal source text (`"admin"` or `'a'`) to a single-quoted DSL token. */
function dslLiteral(raw: string): string {
  const m = raw.match(/^["'](.*)["']$/s);
  return m ? `'${m[1]}'` : raw;
}

function stringDsl(checks: StringCheck[]): string {
  let keyword = 'string';
  let min: string | undefined;
  let max: string | undefined;
  let regex: string | undefined;
  for (const c of checks) {
    if (c.check === 'email' || c.check === 'url' || c.check === 'uuid')
      keyword = `string.${c.check}`;
    else if (c.check === 'regex') regex = c.pattern;
    else if (c.check === 'min') min = c.value;
    else if (c.check === 'max') max = c.value;
  }
  // A regex with no other refinement is expressed as a bare pattern literal.
  if (regex && keyword === 'string' && min === undefined && max === undefined) return regex;
  if (min !== undefined && max !== undefined) return `${min} <= ${keyword} <= ${max}`;
  if (min !== undefined) return `${keyword} >= ${min}`;
  if (max !== undefined) return `${keyword} <= ${max}`;
  return keyword;
}

function numberDsl(checks: NumberCheck[]): string {
  let keyword = 'number';
  let lower: string | undefined;
  let lowerOp: '>' | '>=' | undefined;
  let upper: string | undefined;
  let upperOp: '<' | '<=' | undefined;
  for (const c of checks) {
    if (c.check === 'int') keyword = 'number.integer';
    else if (c.check === 'positive') {
      lower = '0';
      lowerOp = '>';
    } else if (c.check === 'negative') {
      upper = '0';
      upperOp = '<';
    } else if (c.check === 'min') {
      lower = c.value;
      lowerOp = '>=';
    } else if (c.check === 'max') {
      upper = c.value;
      upperOp = '<=';
    }
  }
  if (lower !== undefined && upper !== undefined) {
    return `${lower} ${lowerOp === '>' ? '<' : '<='} ${keyword} ${upperOp} ${upper}`;
  }
  if (lower !== undefined) return `${keyword} ${lowerOp} ${lower}`;
  if (upper !== undefined) return `${keyword} ${upperOp} ${upper}`;
  return keyword;
}

/** Inner DSL string for scalar-like nodes (no surrounding quotes), or null. */
function scalarDsl(node: SchemaNode): string | null {
  switch (node.kind) {
    case 'string':
      return stringDsl(node.checks);
    case 'number':
      return numberDsl(node.checks);
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'unknown':
      return 'unknown';
    case 'enum':
      return node.literals.map(dslLiteral).join(' | ');
    case 'literal':
      return dslLiteral(node.raw);
    case 'union': {
      const parts = node.options.map(scalarDsl);
      return parts.every((p) => p !== null) ? parts.join(' | ') : null;
    }
    default:
      return null;
  }
}

/** A `lazyRef` back to the schema currently being rendered → arktype's `this`. */
function isSelfRef(node: SchemaNode, ctx: RenderContext): boolean {
  return node.kind === 'lazyRef' && node.name === ctx.selfName;
}

/**
 * Whether `node` contains a `lazyRef` to any schema other than `selfName` —
 * i.e. a mutual-recursion back-edge that arktype can't express per-name.
 */
function hasForeignLazyRef(node: SchemaNode, selfName: string): boolean {
  switch (node.kind) {
    case 'lazyRef':
      return node.name !== selfName;
    case 'array':
      return hasForeignLazyRef(node.element, selfName);
    case 'optional':
    case 'annotated':
      return hasForeignLazyRef(node.inner, selfName);
    case 'union':
      return node.options.some((o) => hasForeignLazyRef(o, selfName));
    case 'object':
      return node.fields.some((f) => hasForeignLazyRef(f.value, selfName));
    default:
      return false;
  }
}

function render(node: SchemaNode, ctx: RenderContext): string {
  // Self-reference (recursion site) → arktype `this` keyword (DSL string).
  if (isSelfRef(node, ctx)) return JSON.stringify('this');
  // Scalar-like → arktype string-DSL value.
  const scalar = scalarDsl(node);
  if (scalar !== null) {
    const text = JSON.stringify(scalar);
    return node.kind === 'unknown' && node.note ? `${text} /* ${node.note} */` : text;
  }
  switch (node.kind) {
    case 'instanceof':
      return node.ctor;
    case 'ref':
    case 'lazyRef':
      return node.name;
    case 'object': {
      if (node.fields.length === 0) return '{}';
      const inner = node.fields
        .map((f) => {
          if (f.value.kind === 'optional') {
            return `${objectKey(f.key, true)}: ${render(f.value.inner, ctx)}`;
          }
          return `${objectKey(f.key, false)}: ${render(f.value, ctx)}`;
        })
        .join(', ');
      return `{ ${inner} }`;
    }
    case 'array': {
      const el = node.element;
      if (isSelfRef(el, ctx)) return JSON.stringify('this[]');
      if (el.kind === 'ref' || el.kind === 'lazyRef') return `${el.name}.array()`;
      const elScalar = scalarDsl(el);
      if (elScalar !== null) {
        const needsParens = /[ |]/.test(elScalar);
        return JSON.stringify(needsParens ? `(${elScalar})[]` : `${elScalar}[]`);
      }
      return `[${render(el, ctx)}, "[]"]`;
    }
    case 'optional':
      // Optionality is expressed on the object key; a bare optional renders its inner.
      return render(node.inner, ctx);
    case 'annotated': {
      const comments = node.unmappable
        .map((n) => `/* @${n}: not translatable to arktype (server-only) */`)
        .join(' ');
      return `${render(node.inner, ctx)} ${comments}`;
    }
    default:
      return '"unknown"';
  }
}

export const arktypeAdapter: ValidationAdapter = {
  name: 'arktype',
  importStatements(usage: AdapterUsage): string[] {
    return usage.used ? ["import { type } from 'arktype';"] : [];
  },
  render,
  inferType(schemaConst: string): string {
    return `(typeof ${schemaConst}).infer`;
  },
  renderModule(mod: SchemaModule): RenderedModule {
    const namedNestedSchemas = new Map<string, string>();
    const warnings = [...mod.warnings];
    for (const [name, node] of mod.named) {
      // A lazyRef to a *different* named schema (mutual recursion) cannot be
      // expressed per-name in arktype without a scope; degrade it to unknown.
      if (hasForeignLazyRef(node, name)) {
        namedNestedSchemas.set(name, "type('unknown')");
        warnings.push(
          `${name} is part of a mutually-recursive cycle; arktype can only express self-recursion (via \`this\`) per schema, so this one was degraded to unknown. Use the zod or valibot adapter for full validation.`,
        );
        continue;
      }
      // Self-recursion renders via `this`; pass the schema's own name as selfName.
      namedNestedSchemas.set(name, `type(${render(node, { named: mod.named, selfName: name })})`);
    }
    return {
      schemaText: `type(${render(mod.root, { named: mod.named })})`,
      namedNestedSchemas,
      warnings,
    };
  },
};
