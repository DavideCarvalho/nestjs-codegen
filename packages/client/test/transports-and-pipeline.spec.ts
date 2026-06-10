import { describe, expect, it, vi } from 'vitest';
import { composeTransformers, createFetcher } from '../src/fetcher/fetcher.js';
import { axiosTransport } from '../src/transports/axios.js';

describe('axiosTransport (bring your own axios instance)', () => {
  it('routes requests through the axios instance and maps the response', async () => {
    const request = vi.fn(async (config: { method: string; url: string; data?: unknown }) => ({
      status: 200,
      statusText: 'OK',
      data: JSON.stringify({ ok: true, echoed: config.data ?? null }),
      headers: { 'content-type': 'application/json' },
    }));
    const api = createFetcher({ transport: axiosTransport({ request }) });

    const out = await api.post<{ ok: boolean; echoed: string }>('/x', { body: { a: 1 } });
    expect(out).toEqual({ ok: true, echoed: '{"a":1}' });
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: 'POST',
      url: '/x',
      data: '{"a":1}',
      responseType: 'text',
    });
  });

  it('non-2xx from axios → ApiHttpError (validateStatus lets it through)', async () => {
    const request = async () => ({
      status: 500,
      statusText: 'Server Error',
      data: '{"message":"boom"}',
      headers: { 'content-type': 'application/json' },
    });
    const api = createFetcher({ transport: axiosTransport({ request }) });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 500, body: { message: 'boom' } });
  });

  it('supports an AxiosHeaders-like object with .get()', async () => {
    const request = async () => ({
      status: 200,
      statusText: 'OK',
      data: '{"v":1}',
      headers: { get: (n: string) => (n === 'content-type' ? 'application/json' : null) },
    });
    const api = createFetcher({ transport: axiosTransport({ request }) });
    expect(await api.get<{ v: number }>('/x')).toEqual({ v: 1 });
  });
});

describe('transformer pipeline (array)', () => {
  // base: value <-> string (superjson-like, here just JSON)
  const base = {
    stringify: (v: unknown) => JSON.stringify(v),
    parse: <T>(t: string) => JSON.parse(t) as T,
  };
  // wrapper: string <-> string (reversible "encryption" = reverse the string)
  const reverse = {
    stringify: (s: unknown) => String(s).split('').reverse().join(''),
    parse: <T>(s: string) => s.split('').reverse().join('') as T,
  };

  it('composeTransformers round-trips through base + wrapper', () => {
    const t = composeTransformers([base, reverse]);
    const wire = t.stringify({ a: 1 });
    expect(wire).toBe('}1:"a"{'); // JSON then reversed
    expect(t.parse(wire)).toEqual({ a: 1 });
  });

  it('createFetcher accepts a transformer array end-to-end', async () => {
    const fetch = vi.fn(async (_url: string, init: { body?: string }) => {
      // server "echoes" by applying the same pipeline server-side; simulate by
      // decoding the request and re-encoding as the response.
      const t = composeTransformers([base, reverse]);
      const received = t.parse<{ a: number }>(init.body as string);
      return new Response(t.stringify({ doubled: received.a * 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const api = createFetcher({
      fetch: fetch as unknown as typeof globalThis.fetch,
      transformer: [base, reverse],
    });
    const out = await api.post<{ doubled: number }>('/x', { body: { a: 21 } });
    expect(out).toEqual({ doubled: 42 });
  });
});
