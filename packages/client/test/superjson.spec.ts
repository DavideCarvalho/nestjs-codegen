import 'reflect-metadata';
import { Readable } from 'node:stream';
import { type CallHandler, type ExecutionContext, StreamableFile } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import superjson from 'superjson';
import { describe, expect, it } from 'vitest';
import { createFetcher } from '../src/fetcher/fetcher.js';
import {
  SUPERJSON_HEADER,
  SuperjsonInterceptor,
  superjsonFetcherOptions,
  withSuperjson,
} from '../src/superjson/index.js';

/** Metadata key NestJS's `@Sse()` decorator stamps onto the route handler. */
const SSE_METADATA = '__sse__';

/**
 * Minimal ExecutionContext exposing the request headers the interceptor reads
 * and an optional `handler` so SSE-metadata detection (`getHandler()`) is
 * exercisable. Defaults to a bare function with no metadata (a normal route).
 */
function makeContext(
  headers: Record<string, string>,
  handler: () => void = () => undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

/** CallHandler whose handle() emits the given payload once. */
function makeNext(payload: unknown): CallHandler {
  return { handle: () => of(payload) };
}

describe('SuperjsonInterceptor (content negotiation)', () => {
  it('WITH x-superjson header → response is superjson-serialized ({json,meta}), Dates revive', async () => {
    const interceptor = new SuperjsonInterceptor();
    const now = new Date('2024-01-02T03:04:05.000Z');
    const payload = { when: now, tag: 'hi' };

    const result = (await firstValueFrom(
      interceptor.intercept(makeContext({ [SUPERJSON_HEADER]: '1' }), makeNext(payload)),
    )) as { json: unknown; meta: unknown };

    // Envelope shape, not the raw object.
    expect(result).toHaveProperty('json');
    expect(result).toHaveProperty('meta');
    expect((result.json as { when: unknown }).when).toBe(now.toISOString());

    // Round-trips back to a real Date via superjson.deserialize.
    const revived = superjson.deserialize<typeof payload>(
      result as Parameters<typeof superjson.deserialize>[0],
    );
    expect(revived.when).toBeInstanceOf(Date);
    expect(revived.when.getTime()).toBe(now.getTime());
    expect(revived.tag).toBe('hi');
  });

  it('WITHOUT x-superjson header → plain object passthrough (no envelope)', async () => {
    const interceptor = new SuperjsonInterceptor();
    const payload = { when: new Date('2024-01-02T03:04:05.000Z'), tag: 'hi' };

    const result = await firstValueFrom(interceptor.intercept(makeContext({}), makeNext(payload)));

    expect(result).toBe(payload);
    expect(result).not.toHaveProperty('meta');
  });

  it('x-superjson header with a non-"1" value is treated as opt-out', async () => {
    const interceptor = new SuperjsonInterceptor();
    const payload = { tag: 'hi' };

    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ [SUPERJSON_HEADER]: '0' }), makeNext(payload)),
    );

    expect(result).toBe(payload);
  });

  it('WITH header + StreamableFile → passed through unchanged (no envelope)', async () => {
    const interceptor = new SuperjsonInterceptor();
    const file = new StreamableFile(Buffer.from('hello'));

    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ [SUPERJSON_HEADER]: '1' }), makeNext(file)),
    );

    expect(result).toBe(file);
    expect(result).not.toHaveProperty('json');
  });

  it('WITH header + SSE handler → passed through unchanged (never serialized)', async () => {
    const interceptor = new SuperjsonInterceptor();
    // A handler tagged like NestJS `@Sse()` does (Reflect.defineMetadata on the fn).
    const sseHandler = () => undefined;
    Reflect.defineMetadata(SSE_METADATA, true, sseHandler);
    // A MessageEvent-shaped payload an @Sse() route would emit.
    const event = { data: { now: new Date('2024-01-02T03:04:05.000Z') } };

    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ [SUPERJSON_HEADER]: '1' }, sseHandler), makeNext(event)),
    );

    // Untouched: still the raw event object, NOT a { json, meta } envelope.
    expect(result).toBe(event);
    expect(result).not.toHaveProperty('json');
    expect(result).not.toHaveProperty('meta');
  });

  it('WITH header + Node Readable stream → passed through unchanged', async () => {
    const interceptor = new SuperjsonInterceptor();
    const stream = Readable.from(['chunk']);

    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ [SUPERJSON_HEADER]: '1' }), makeNext(stream)),
    );

    expect(result).toBe(stream);
    expect(result).not.toHaveProperty('json');
  });

  it('WITH header + Buffer → passed through unchanged (raw bytes, not base64 envelope)', async () => {
    const interceptor = new SuperjsonInterceptor();
    const buffer = Buffer.from('raw-bytes');

    const result = await firstValueFrom(
      interceptor.intercept(makeContext({ [SUPERJSON_HEADER]: '1' }), makeNext(buffer)),
    );

    expect(result).toBe(buffer);
    expect(result).not.toHaveProperty('json');
  });

  it('WITH header + plain array → still gets the superjson envelope', async () => {
    const interceptor = new SuperjsonInterceptor();
    const payload = [1, 2, 3];

    const result = (await firstValueFrom(
      interceptor.intercept(makeContext({ [SUPERJSON_HEADER]: '1' }), makeNext(payload)),
    )) as { json: unknown };

    expect(result).toHaveProperty('json');
    expect(result.json).toEqual([1, 2, 3]);
  });
});

describe('superjsonFetcherOptions', () => {
  it('sends the x-superjson opt-in header', () => {
    const opts = superjsonFetcherOptions();
    expect(opts.headers?.()).toEqual({ [SUPERJSON_HEADER]: '1' });
  });

  it('round-trips a superjson envelope through the fetcher deserialize hook into a real Date', async () => {
    const now = new Date('2024-05-06T07:08:09.000Z');
    const envelope = superjson.serialize({ when: now });
    const fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )) as unknown as typeof globalThis.fetch;

    const fetcher = createFetcher({ fetch, ...superjsonFetcherOptions() });
    const result = (await fetcher.get('/thing')) as { when: Date };
    expect(result.when).toBeInstanceOf(Date);
    expect(result.when.getTime()).toBe(now.getTime());
  });
});

describe('withSuperjson', () => {
  it('composes caller headers with the superjson opt-in header', () => {
    const merged = withSuperjson({ headers: () => ({ authorization: 'Bearer tok' }) });
    expect(merged.headers?.()).toEqual({
      authorization: 'Bearer tok',
      [SUPERJSON_HEADER]: '1',
    });
    expect(merged.deserialize).toBeTypeOf('function');
  });
});
