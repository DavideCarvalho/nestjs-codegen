import { describe, expect, it } from 'vitest';
import type { SchemaModule, SchemaNode } from '../../src/ir/schema-node.js';

describe('SchemaNode IR', () => {
  it('constructs a nested object module', () => {
    const node: SchemaNode = {
      kind: 'object',
      passthrough: false,
      fields: [{ key: 'email', value: { kind: 'string', checks: [{ check: 'email' }] } }],
    };
    const mod: SchemaModule = { root: node, named: new Map(), warnings: [] };
    expect(mod.root.kind).toBe('object');
  });
});
