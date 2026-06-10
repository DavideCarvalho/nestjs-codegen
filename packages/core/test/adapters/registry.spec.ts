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

  it('throws a clear error for not-yet-available adapters', () => {
    expect(() => resolveAdapter('valibot')).toThrow(/valibot.*not yet available/i);
    expect(() => resolveAdapter('arktype')).toThrow(/arktype.*not yet available/i);
  });
});
