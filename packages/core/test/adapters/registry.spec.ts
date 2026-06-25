import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { describe, expect, it } from 'vitest';
import { resolveAdapter } from '../../src/adapters/registry.js';

describe('resolveAdapter', () => {
  it('passes through a real imported adapter instance', () => {
    expect(resolveAdapter(zodAdapter)).toBe(zodAdapter);
  });

  it('passes through a custom adapter object', () => {
    const custom = { ...zodAdapter, name: 'custom' };
    expect(resolveAdapter(custom)).toBe(custom);
  });

  it('throws the helpful "install + import the adapter package" error for a string shortcut', () => {
    // `ValidationOption` no longer types strings, but JS callers / untyped configs
    // can still pass one (the signature keeps `| string`) — the runtime guard fires.
    expect(() => resolveAdapter('zod')).toThrow(/@dudousxd\/nestjs-codegen-zod/);
    expect(() => resolveAdapter('zod')).toThrow(/zodAdapter/);
    expect(() => resolveAdapter('zod')).toThrow(/is not bundled in core/);
    expect(() => resolveAdapter('zod')).toThrow(/pass the adapter instance/);
  });

  it('directs to the adapter package for every removed string shortcut', () => {
    expect(() => resolveAdapter('valibot')).toThrow(/@dudousxd\/nestjs-codegen-valibot/);
    expect(() => resolveAdapter('valibot')).toThrow(/valibotAdapter/);
    expect(() => resolveAdapter('arktype')).toThrow(/@dudousxd\/nestjs-codegen-arktype/);
    expect(() => resolveAdapter('arktype')).toThrow(/arktypeAdapter/);
  });
});
