import { describe, expect, it } from 'vitest';
import { resolveAdapter } from '../../src/adapters/registry.js';
import { zodAdapter } from '../../src/adapters/zod.js';

describe('resolveAdapter', () => {
  it("'zod' → zodAdapter", () => {
    expect(resolveAdapter('zod')).toBe(zodAdapter);
  });

  it('passes through a custom adapter object', () => {
    const custom = { ...zodAdapter, name: 'custom' };
    expect(resolveAdapter(custom)).toBe(custom);
  });

  it('directs to the adapter package for non-bundled string options', () => {
    expect(() => resolveAdapter('valibot')).toThrow(/@dudousxd\/nestjs-codegen-valibot/);
    expect(() => resolveAdapter('valibot')).toThrow(/valibotAdapter/);
    expect(() => resolveAdapter('arktype')).toThrow(/@dudousxd\/nestjs-codegen-arktype/);
  });
});
