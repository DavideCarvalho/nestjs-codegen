import { describe, expect, it, vi } from 'vitest';
import { ApiHttpError } from '../src/fetcher/errors.js';
import { createFetcher } from '../src/fetcher/fetcher.js';
import { buildUrl } from '../src/fetcher/url-builder.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildUrl', () => {
  it('interpolates params, encodes traversal, appends query, prepends base', () => {
    expect(buildUrl('/users/:id', { params: { id: 42 } })).toBe('/users/42');
    expect(buildUrl('/users/:id', { params: { id: '../admin' } })).toBe('/users/..%2Fadmin');
    expect(buildUrl('/users', { query: { active: true } })).toBe('/users?active=true');
    expect(buildUrl('/users', {}, 'https://api.test/')).toBe('https://api.test/users');
  });
});

describe('createFetcher', () => {
  it('GET parses JSON; sends accept header', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    const out = await api.get<{ ok: boolean }>('/x');
    expect(out).toEqual({ ok: true });
    expect((fetch.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      accept: 'application/json',
    });
  });

  it('POST JSON-encodes the body and sets content-type', async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: 1 }));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    await api.post('/x', { body: { a: 1 } });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('throws ApiHttpError on non-2xx and calls onError', async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: 'nope' }, 403));
    const onError = vi.fn();
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch, onError });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiHttpError);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('returns undefined on 204', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await api.delete('/x')).toBeUndefined();
  });

  describe('custom transport (bring your own HTTP client, e.g. axios)', () => {
    it('routes requests through the provided transport instead of fetch', async () => {
      const calls: Array<{ method: string; url: string; body?: unknown }> = [];
      const transport = vi.fn(async (req: { method: string; url: string; body?: unknown }) => {
        calls.push({ method: req.method, url: req.url, body: req.body });
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          contentType: 'application/json',
          text: async () => JSON.stringify({ via: 'axios', id: 7 }),
        };
      });
      const api = createFetcher({ baseUrl: 'https://api.test', transport });
      const out = await api.post<{ via: string; id: number }>('/users/:id', {
        params: { id: 7 },
        body: { name: 'Ada' },
      });
      expect(out).toEqual({ via: 'axios', id: 7 });
      expect(calls[0]).toEqual({
        method: 'POST',
        url: 'https://api.test/users/7',
        body: '{"name":"Ada"}',
      });
    });

    it('maps a non-2xx transport response to ApiHttpError', async () => {
      const transport = async () => ({
        ok: false,
        status: 422,
        statusText: 'Unprocessable',
        contentType: 'application/json',
        text: async () => '{"message":"bad"}',
      });
      const api = createFetcher({ transport });
      await expect(api.get('/x')).rejects.toMatchObject({ status: 422, body: { message: 'bad' } });
    });
  });

  describe('superjson transformer', () => {
    // A minimal stand-in for superjson: round-trips Date via a {__d} marker.
    const transformer = {
      stringify(value: unknown): string {
        // `this[key]` is the raw value before Date.toJSON() runs, so we can detect Date.
        return JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
          const raw = this[key];
          return raw instanceof Date ? { __d: raw.toISOString() } : v;
        });
      },
      parse<T>(text: string): T {
        return JSON.parse(text, (_k, v) =>
          v && typeof v === 'object' && '__d' in v ? new Date(v.__d) : v,
        ) as T;
      },
    };

    it('uses the transformer to serialize the request body', async () => {
      const fetch = vi.fn(async () => jsonResponse({ ok: true }));
      const api = createFetcher({
        fetch: fetch as unknown as typeof globalThis.fetch,
        transformer,
      });
      await api.post('/x', { body: { when: new Date('2026-06-10T00:00:00.000Z') } });
      const init = fetch.mock.calls[0]?.[1] as RequestInit;
      expect(init.body).toBe('{"when":{"__d":"2026-06-10T00:00:00.000Z"}}');
    });

    it('uses the transformer to revive rich types in the response (Date survives)', async () => {
      const fetch = vi.fn(async () => jsonResponse('{"when":{"__d":"2026-06-10T00:00:00.000Z"}}'));
      const api = createFetcher({
        fetch: fetch as unknown as typeof globalThis.fetch,
        transformer,
      });
      const out = await api.get<{ when: Date }>('/x');
      expect(out.when).toBeInstanceOf(Date);
      expect(out.when.toISOString()).toBe('2026-06-10T00:00:00.000Z');
    });
  });
});

describe('fetcher.sse — server-sent events streaming', () => {
  function sseResponse(chunks: string[], status = 200): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    return new Response(stream, {
      status,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('yields JSON-parsed data payloads as a typed async iterable', async () => {
    const fetch = vi.fn(async () =>
      sseResponse(['data: {"count":1}\n\n', 'data: {"count":2}\n\n']),
    );
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    const seen: number[] = [];
    for await (const ev of api.sse<{ count: number }>('/events')) {
      seen.push(ev.count);
    }
    expect(seen).toEqual([1, 2]);
    // accept header negotiates the event-stream content type
    expect((fetch.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      accept: 'text/event-stream',
    });
  });

  it('handles events split across chunk boundaries', async () => {
    const fetch = vi.fn(async () => sseResponse(['data: {"co', 'unt":7}\n\n']));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    const seen: number[] = [];
    for await (const ev of api.sse<{ count: number }>('/events')) {
      seen.push(ev.count);
    }
    expect(seen).toEqual([7]);
  });

  it('throws ApiHttpError on a non-ok response', async () => {
    const fetch = vi.fn(
      async () => new Response('nope', { status: 500, headers: { 'content-type': 'text/plain' } }),
    );
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(async () => {
      for await (const _ of api.sse('/events')) {
        // unreachable
      }
    }).rejects.toBeInstanceOf(ApiHttpError);
  });
});
