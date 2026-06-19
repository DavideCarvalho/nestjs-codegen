import {
  type AdapterUsage,
  type RenderContext,
  type SchemaNode,
  type StringCheck,
  type ValidationAdapter,
  createChainModuleRenderer,
  toObjectKey,
} from '@dudousxd/nestjs-codegen';

function messageSuffix(messageRaw: string | undefined): string {
  return messageRaw ? `{ message: ${messageRaw} }` : '';
}

function renderStringChecks(checks: StringCheck[]): string {
  let out = '';
  for (const c of checks) {
    switch (c.check) {
      case 'email':
        out += `.email(${messageSuffix(c.messageRaw)})`;
        break;
      case 'url':
        out += `.url(${messageSuffix(c.messageRaw)})`;
        break;
      case 'uuid':
        out += `.uuid(${messageSuffix(c.messageRaw)})`;
        break;
      case 'regex':
        out += `.regex(${c.pattern})`;
        break;
      case 'min':
        out += `.min(${c.value})`;
        break;
      case 'max':
        out += `.max(${c.value})`;
        break;
    }
  }
  return out;
}

function render(node: SchemaNode, ctx: RenderContext): string {
  switch (node.kind) {
    case 'string':
      return `z.string()${renderStringChecks(node.checks)}`;
    case 'number': {
      let out = 'z.number()';
      for (const c of node.checks) {
        if (c.check === 'int') out += '.int()';
        else if (c.check === 'positive') out += '.positive()';
        else if (c.check === 'negative') out += '.negative()';
        else if (c.check === 'min') out += `.min(${c.value})`;
        else if (c.check === 'max') out += `.max(${c.value})`;
      }
      return out;
    }
    case 'boolean':
      return 'z.boolean()';
    case 'date':
      return 'z.coerce.date()';
    case 'unknown':
      return node.note ? `z.unknown() /* ${node.note} */` : 'z.unknown()';
    case 'instanceof':
      return `z.instanceof(${node.ctor})`;
    case 'enum':
      return `z.enum([${node.literals.join(', ')}])`;
    case 'literal':
      return `z.literal(${node.raw})`;
    case 'union': {
      const opts = node.options.map((o) => render(o, ctx)).join(', ');
      return node.discriminator
        ? `z.discriminatedUnion(${JSON.stringify(node.discriminator)}, [${opts}])`
        : `z.union([${opts}])`;
    }
    case 'object': {
      if (node.fields.length === 0) {
        return node.passthrough ? 'z.object({}).passthrough()' : 'z.object({})';
      }
      const inner = node.fields
        .map((f) => `${toObjectKey(f.key)}: ${render(f.value, ctx)}`)
        .join(', ');
      return `z.object({ ${inner} })${node.passthrough ? '.passthrough()' : ''}`;
    }
    case 'array':
      return `z.array(${render(node.element, ctx)})`;
    case 'optional':
      return `${render(node.inner, ctx)}.optional()`;
    case 'ref':
      return node.name;
    case 'lazyRef':
      return `z.lazy(() => ${node.name})`;
    case 'annotated': {
      const comments = node.unmappable
        .map((n) => `/* @${n}: not translatable to zod (server-only) */`)
        .join(' ');
      return `${render(node.inner, ctx)} ${comments}`;
    }
  }
}

export const zodAdapter: ValidationAdapter = {
  name: 'zod',
  acceptsRawZodSource: true,
  importStatements(usage: AdapterUsage): string[] {
    return usage.used ? ["import { z } from 'zod';"] : [];
  },
  render,
  inferType(schemaConst: string): string {
    return `z.infer<typeof ${schemaConst}>`;
  },
  renderModule: createChainModuleRenderer({
    render,
    recursiveAnnotation: (typeName) => `z.ZodType<${typeName}>`,
  }),
};
