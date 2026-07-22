import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { QueryList, resolveQueryList, toStringList } from '../../src/nest/query-list.js';

describe('toStringList', () => {
  it('returns [] for undefined / null (optional param absent)', () => {
    expect(toStringList(undefined)).toEqual([]);
    expect(toStringList(null)).toEqual([]);
  });

  it('wraps a single bare string into a one-element array (the ?ids=a footgun case)', () => {
    expect(toStringList('a')).toEqual(['a']);
  });

  it('passes through a repeated-param string[] (?ids=a&ids=b)', () => {
    expect(toStringList(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('splits a comma-joined string (?ids=a,b — the client comma default wire form)', () => {
    expect(toStringList('a,b')).toEqual(['a', 'b']);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(toStringList(' a , , b ,')).toEqual(['a', 'b']);
    expect(toStringList([' a ', '', 'b'])).toEqual(['a', 'b']);
  });

  it('stringifies non-string array elements', () => {
    expect(toStringList([1, 2])).toEqual(['1', '2']);
  });
});

/** Minimal ExecutionContext exposing just the http request the resolver reads. */
function ctxWithQuery(query: Record<string, unknown> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  } as unknown as ExecutionContext;
}

describe('resolveQueryList (the QueryList seam)', () => {
  it('normalizes a single-value param to a one-element array', () => {
    expect(resolveQueryList('baseIds', ctxWithQuery({ baseIds: 'a' }))).toEqual(['a']);
  });

  it('normalizes a repeated param to the full array', () => {
    expect(resolveQueryList('baseIds', ctxWithQuery({ baseIds: ['a', 'b'] }))).toEqual(['a', 'b']);
  });

  it('normalizes a comma-joined param', () => {
    expect(resolveQueryList('baseIds', ctxWithQuery({ baseIds: 'a,b' }))).toEqual(['a', 'b']);
  });

  it('returns [] when the param is absent or no key is given', () => {
    expect(resolveQueryList('baseIds', ctxWithQuery({}))).toEqual([]);
    expect(resolveQueryList('baseIds', ctxWithQuery(undefined))).toEqual([]);
    expect(resolveQueryList(undefined, ctxWithQuery({ baseIds: 'a' }))).toEqual([]);
  });
});

describe('QueryList decorator', () => {
  it('is a param decorator factory (callable with a key)', () => {
    // createParamDecorator returns a factory; calling it yields a ParameterDecorator.
    expect(typeof QueryList).toBe('function');
    expect(typeof QueryList('baseIds')).toBe('function');
  });
});
