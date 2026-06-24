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

describe('axiosTransport — blob / headers / upload progress', () => {
  it('blob download: returns the Blob untouched and exposes response headers', async () => {
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    const request = vi.fn(async (config: { responseType: string }) => {
      expect(config.responseType).toBe('blob');
      return {
        status: 200,
        statusText: 'OK',
        data: pdf,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="report.pdf"',
          'x-auth-token': 'rotated-token',
        },
      };
    });
    const api = createFetcher({ transport: axiosTransport({ request }) });

    const res = await api.fetchBlob('/reports/42');
    expect(res.data).toBe(pdf);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="report.pdf"');
    expect(res.headers['x-auth-token']).toBe('rotated-token');
  });

  it('maps neutral responseType arrayBuffer → axios "arraybuffer"', async () => {
    const buffer = new ArrayBuffer(8);
    const request = vi.fn(async (config: { responseType: string }) => {
      expect(config.responseType).toBe('arraybuffer');
      return { status: 200, statusText: 'OK', data: buffer, headers: {} };
    });
    const api = createFetcher({ transport: axiosTransport({ request }) });
    const res = await api.fetchRaw<ArrayBuffer>('/bin', { responseType: 'arrayBuffer' });
    expect(res.data).toBe(buffer);
  });

  it('forwards onUploadProgress through to the axios config', async () => {
    let axiosProgress: ((e: { loaded: number; total?: number }) => void) | undefined;
    const request = vi.fn(
      async (config: { onUploadProgress?: (e: { loaded: number; total?: number }) => void }) => {
        axiosProgress = config.onUploadProgress;
        // simulate axios emitting progress mid-upload
        axiosProgress?.({ loaded: 50, total: 100 });
        axiosProgress?.({ loaded: 100, total: 100 });
        return {
          status: 201,
          statusText: 'Created',
          data: '{"id":"abc"}',
          headers: { 'content-type': 'application/json' },
        };
      },
    );
    const api = createFetcher({ transport: axiosTransport({ request }) });

    const seen: Array<{ loaded: number; total?: number }> = [];
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.txt');
    const res = await api.fetchRaw<{ id: string }>('/upload', {
      method: 'POST',
      body: form,
      onUploadProgress: (p) => seen.push(p),
    });

    expect(res.data).toEqual({ id: 'abc' });
    expect(seen).toEqual([
      { loaded: 50, total: 100 },
      { loaded: 100, total: 100 },
    ]);
  });

  it('omits total when axios does not provide it', async () => {
    const request = vi.fn(
      async (config: { onUploadProgress?: (e: { loaded: number; total?: number }) => void }) => {
        config.onUploadProgress?.({ loaded: 10 });
        return { status: 200, statusText: 'OK', data: '{}', headers: {} };
      },
    );
    const api = createFetcher({ transport: axiosTransport({ request }) });
    const seen: Array<{ loaded: number; total?: number }> = [];
    await api.fetchRaw('/u', { method: 'POST', onUploadProgress: (p) => seen.push(p) });
    expect(seen).toEqual([{ loaded: 10 }]);
  });

  it('reads AxiosHeaders via toJSON() into a lower-cased record', async () => {
    const request = async () => ({
      status: 200,
      statusText: 'OK',
      data: '{"v":1}',
      headers: {
        toJSON: () => ({ 'Content-Type': 'application/json', 'X-Auth-Token': 't' }),
      },
    });
    const api = createFetcher({ transport: axiosTransport({ request }) });
    const res = await api.fetchRaw<{ v: number }>('/x');
    expect(res.data).toEqual({ v: 1 });
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['x-auth-token']).toBe('t');
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
