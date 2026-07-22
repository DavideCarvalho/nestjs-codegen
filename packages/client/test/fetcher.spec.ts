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

describe('buildUrl array query params', () => {
  it('comma-joins array params by default (?k=a,b, URL-encoded), preserving legacy behavior', () => {
    // Default is 'comma' — byte-identical to the historical String(array) behavior.
    expect(buildUrl('/x', { query: { baseIds: ['a', 'b'] } })).toBe('/x?baseIds=a%2Cb');
  });

  it("repeats array params when arrayFormat: 'repeat' (?k=a&k=b)", () => {
    expect(buildUrl('/x', { query: { baseIds: ['a', 'b'] }, arrayFormat: 'repeat' })).toBe(
      '/x?baseIds=a&baseIds=b',
    );
  });

  it('comma-joins a single-element array into one param (?k=a) — matches legacy', () => {
    expect(buildUrl('/x', { query: { baseIds: ['a'] } })).toBe('/x?baseIds=a');
  });

  it('repeats a single-element array as exactly one param (?k=a)', () => {
    expect(buildUrl('/x', { query: { baseIds: ['a'] }, arrayFormat: 'repeat' })).toBe(
      '/x?baseIds=a',
    );
  });

  it('scalar query params are unchanged under either format', () => {
    expect(buildUrl('/x', { query: { active: true } })).toBe('/x?active=true');
    expect(buildUrl('/x', { query: { active: true }, arrayFormat: 'repeat' })).toBe(
      '/x?active=true',
    );
  });

  it("'repeat' skips null/undefined array elements; 'comma' stringifies them like Array#join", () => {
    // repeat: nullish elements are dropped (no empty repeated param).
    expect(
      buildUrl('/x', { query: { ids: ['a', null, undefined, 'b'] }, arrayFormat: 'repeat' }),
    ).toBe('/x?ids=a&ids=b');
    // comma: String(array) === Array.prototype.join, which renders null/undefined as
    // empty strings — byte-identical to the pre-arrayFormat legacy behavior.
    expect(buildUrl('/x', { query: { ids: ['a', null, undefined, 'b'] } })).toBe(
      '/x?ids=a%2C%2C%2Cb',
    );
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

  it('POST builds a FormData (not JSON) when multipart and keeps File parts', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    const file = new Blob(['col1,col2'], { type: 'text/csv' });
    await api.post('/upload', {
      body: { type: 'MEL', date: '2026-06-30', file },
      multipart: true,
    });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    const fd = init.body as FormData;
    expect(fd.get('type')).toBe('MEL');
    expect(fd.get('date')).toBe('2026-06-30');
    expect(fd.get('file')).toBeInstanceOf(Blob);
    // The runtime sets the multipart boundary; we must NOT force a JSON content-type.
    expect(init.headers).not.toMatchObject({ 'content-type': 'application/json' });
  });

  it('appends array fields as repeated multipart parts (multi-file)', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    const a = new Blob(['a'], { type: 'text/csv' });
    const b = new Blob(['b'], { type: 'text/csv' });
    await api.post('/upload', { body: { files: [a, b] }, multipart: true });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const fd = init.body as FormData;
    expect(fd.getAll('files')).toHaveLength(2);
  });

  it('threads a fetcher-level arrayFormat into the request URL', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createFetcher({
      fetch: fetch as unknown as typeof globalThis.fetch,
      arrayFormat: 'repeat',
    });
    await api.get('/x', { query: { baseIds: ['a', 'b'] } });
    expect(fetch.mock.calls[0]?.[0]).toBe('/x?baseIds=a&baseIds=b');
  });

  it('a per-request arrayFormat overrides the fetcher-level default', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createFetcher({
      fetch: fetch as unknown as typeof globalThis.fetch,
      arrayFormat: 'comma',
    });
    await api.get('/x', { query: { baseIds: ['a', 'b'] }, arrayFormat: 'repeat' });
    expect(fetch.mock.calls[0]?.[0]).toBe('/x?baseIds=a&baseIds=b');
  });

  it('defaults to comma-joined array params when no arrayFormat is set', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    await api.get('/x', { query: { baseIds: ['a', 'b'] } });
    expect(fetch.mock.calls[0]?.[0]).toBe('/x?baseIds=a%2Cb');
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

describe('createFetcher — fetchBlob / fetchRaw (binary + headers escape hatch)', () => {
  it('fetchBlob returns the Blob untouched and exposes headers + status', async () => {
    const blob = new Blob(['csv,data'], { type: 'text/csv' });
    const fetch = vi.fn(
      async () =>
        new Response(blob, {
          status: 200,
          headers: {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="export.csv"',
          },
        }),
    );
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    const res = await api.fetchBlob('/export');
    expect(res.data).toBeInstanceOf(Blob);
    expect(await res.data.text()).toBe('csv,data');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="export.csv"');
  });

  it('fetchBlob requests responseType blob (defaults to GET)', async () => {
    const fetch = vi.fn(async () => new Response(new Blob(['x']), { status: 200 }));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    await api.fetchBlob('/x');
    expect((fetch.mock.calls[0]?.[1] as RequestInit).method).toBe('GET');
  });

  it('deserialize hook is NOT applied to a blob response', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Blob(['bytes']), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const deserialize = vi.fn((raw: unknown) => raw);
    const api = createFetcher({
      fetch: fetch as unknown as typeof globalThis.fetch,
      deserialize,
    });
    const res = await api.fetchBlob('/x');
    expect(deserialize).not.toHaveBeenCalled();
    expect(res.data).toBeInstanceOf(Blob);
  });

  it('fetchRaw json path returns parsed data + headers and DOES run deserialize', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 9 }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-auth-token': 'abc' },
        }),
    );
    const deserialize = vi.fn((raw: unknown) => ({ ...(raw as object), revived: true }));
    const api = createFetcher({
      fetch: fetch as unknown as typeof globalThis.fetch,
      deserialize,
    });
    const res = await api.fetchRaw<{ id: number; revived: boolean }>('/thing');
    expect(res.data).toEqual({ id: 9, revived: true });
    expect(res.headers['x-auth-token']).toBe('abc');
    expect(deserialize).toHaveBeenCalledOnce();
  });

  it('fetchRaw arrayBuffer returns the buffer untouched', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    const res = await api.fetchRaw<ArrayBuffer>('/bin', { responseType: 'arrayBuffer' });
    expect(res.data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(res.data)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('fetchRaw maps non-2xx to ApiHttpError', async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: 'gone' }, 404));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(api.fetchBlob('/missing')).rejects.toBeInstanceOf(ApiHttpError);
  });

  it('throws a clear error when the transport cannot produce a blob', async () => {
    // A legacy/minimal transport without blob() — fetchBlob must fail loudly.
    const transport = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      contentType: 'application/octet-stream',
      text: async () => '',
    });
    const api = createFetcher({ transport });
    await expect(api.fetchBlob('/x')).rejects.toThrow(/responseType: 'blob'/);
  });
});

describe('JSON path regression — unchanged after adding raw/blob support', () => {
  it('verb methods still parse JSON and ignore the new TransportResponse fields', async () => {
    const transport = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      contentType: 'application/json',
      // Note: NO headers/blob/arrayBuffer — proves the JSON path is back-compat
      // with transports written before this change.
      text: async () => JSON.stringify({ kept: true }),
    }));
    const api = createFetcher({ transport });
    expect(await api.get<{ kept: boolean }>('/x')).toEqual({ kept: true });
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

describe('createFetcher — deserialize hook', () => {
  it('deserialize hook transforms the parsed JSON body', async () => {
    const fetch = vi.fn(async () => jsonResponse({ value: 1 }));
    const deserialize = vi.fn((raw: unknown) => ({
      ...(raw as Record<string, unknown>),
      revived: true,
    }));
    const api = createFetcher({
      fetch: fetch as unknown as typeof globalThis.fetch,
      deserialize,
    });
    const result = await api.get('/thing');
    expect(deserialize).toHaveBeenCalledOnce();
    expect(deserialize.mock.calls[0]?.[0]).toEqual({ value: 1 });
    expect(result).toEqual({ value: 1, revived: true });
  });

  it('absent deserialize hook returns the body unchanged (identity)', async () => {
    const payload = { value: 42 };
    const fetch = vi.fn(async () => jsonResponse(payload));
    const api = createFetcher({ fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await api.get('/thing');
    expect(result).toEqual(payload);
  });

  it('deserialize hook is NOT applied to non-JSON (text) responses', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('plain text', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const deserialize = vi.fn((raw: unknown) => raw);
    const api = createFetcher({
      fetch: fetch as unknown as typeof globalThis.fetch,
      deserialize,
    });
    const result = await api.get('/text');
    expect(deserialize).not.toHaveBeenCalled();
    expect(result).toBe('plain text');
  });
});
