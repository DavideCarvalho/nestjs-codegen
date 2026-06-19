import {
  type AdapterUsage,
  type RenderContext,
  type SchemaNode,
  type StringCheck,
  type ValidationAdapter,
  createChainModuleRenderer,
  toObjectKey,
} from '@dudousxd/nestjs-codegen';

/** `v.string()` / `v.pipe(v.string(), ...actions)` when there are refinements. */
function pipe(base: string, actions: string[]): string {
  return actions.length === 0 ? base : `v.pipe(${base}, ${actions.join(', ')})`;
}

/** A validation action with an optional verbatim message arg. */
function action(name: string, messageRaw?: string): string {
  return messageRaw ? `v.${name}(${messageRaw})` : `v.${name}()`;
}

function stringActions(checks: StringCheck[]): string[] {
  const out: string[] = [];
  for (const c of checks) {
    switch (c.check) {
      case 'email':
        out.push(action('email', c.messageRaw));
        break;
      case 'url':
        out.push(action('url', c.messageRaw));
        break;
      case 'uuid':
        out.push(action('uuid', c.messageRaw));
        break;
      case 'regex':
        out.push(`v.regex(${c.pattern})`);
        break;
      case 'min':
        out.push(`v.minLength(${c.value})`);
        break;
      case 'max':
        out.push(`v.maxLength(${c.value})`);
        break;
    }
  }
  return out;
}

function render(node: SchemaNode, ctx: RenderContext): string {
  switch (node.kind) {
    case 'string':
      return pipe('v.string()', stringActions(node.checks));
    case 'number': {
      const actions: string[] = [];
      for (const c of node.checks) {
        if (c.check === 'int') actions.push('v.integer()');
        else if (c.check === 'min') actions.push(`v.minValue(${c.value})`);
        else if (c.check === 'max') actions.push(`v.maxValue(${c.value})`);
        else if (c.check === 'positive') actions.push('v.check((value) => value > 0)');
        else if (c.check === 'negative') actions.push('v.check((value) => value < 0)');
      }
      return pipe('v.number()', actions);
    }
    case 'boolean':
      return 'v.boolean()';
    case 'date':
      return 'v.date()';
    case 'unknown':
      return node.note ? `v.unknown() /* ${node.note} */` : 'v.unknown()';
    case 'instanceof':
      return `v.instance(${node.ctor})`;
    case 'enum':
      return `v.picklist([${node.literals.join(', ')}])`;
    case 'literal':
      return `v.literal(${node.raw})`;
    case 'union': {
      const opts = node.options.map((o) => render(o, ctx)).join(', ');
      return node.discriminator
        ? `v.variant(${JSON.stringify(node.discriminator)}, [${opts}])`
        : `v.union([${opts}])`;
    }
    case 'object': {
      if (node.fields.length === 0) {
        return node.passthrough ? 'v.looseObject({})' : 'v.object({})';
      }
      const inner = node.fields
        .map((f) => `${toObjectKey(f.key)}: ${render(f.value, ctx)}`)
        .join(', ');
      return node.passthrough ? `v.looseObject({ ${inner} })` : `v.object({ ${inner} })`;
    }
    case 'array':
      return `v.array(${render(node.element, ctx)})`;
    case 'optional':
      return `v.optional(${render(node.inner, ctx)})`;
    case 'ref':
      return node.name;
    case 'lazyRef':
      return `v.lazy(() => ${node.name})`;
    case 'annotated': {
      const comments = node.unmappable
        .map((n) => `/* @${n}: not translatable to valibot (server-only) */`)
        .join(' ');
      return `${render(node.inner, ctx)} ${comments}`;
    }
  }
}

export const valibotAdapter: ValidationAdapter = {
  name: 'valibot',
  importStatements(usage: AdapterUsage): string[] {
    return usage.used ? ["import * as v from 'valibot';"] : [];
  },
  render,
  inferType(schemaConst: string): string {
    return `v.InferOutput<typeof ${schemaConst}>`;
  },
  renderModule: createChainModuleRenderer({
    render,
    recursiveAnnotation: (typeName) => `v.GenericSchema<${typeName}>`,
  }),
};
