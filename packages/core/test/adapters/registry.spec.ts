import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { describe, expect, it } from 'vitest';
import { resolveAdapter } from '../../src/adapters/registry.js';

describe('resolveAdapter', () => {
  it('passes through a custom adapter object', () => {
    const custom = { ...zodAdapter, name: 'custom' };
    expect(resolveAdapter(custom)).toBe(custom);
  });

  it('directs to the adapter package for non-bundled string options', () => {
    expect(() => resolveAdapter('zod')).toThrow(/@dudousxd\/nestjs-codegen-zod/);
    expect(() => resolveAdapter('zod')).toThrow(/zodAdapter/);
    expect(() => resolveAdapter('valibot')).toThrow(/@dudousxd\/nestjs-codegen-valibot/);
    expect(() => resolveAdapter('valibot')).toThrow(/valibotAdapter/);
    expect(() => resolveAdapter('arktype')).toThrow(/@dudousxd\/nestjs-codegen-arktype/);
  });
});
