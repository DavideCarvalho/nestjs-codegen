import type { Transport } from '../fetcher/fetcher.js';

/** Minimal structural shape of an axios instance — your real instance fits this. */
export interface AxiosLike {
  request(config: {
    method: string;
    url: string;
    headers: Record<string, string>;
    data?: string | FormData;
    responseType: 'text';
    validateStatus: (status: number) => boolean;
  }): Promise<{
    status: number;
    statusText?: string;
    data: unknown;
    headers: Record<string, unknown> | { get?(name: string): unknown };
  }>;
}

function readContentType(headers: unknown): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as { get?(n: string): unknown } & Record<string, unknown>;
  const v = typeof h.get === 'function' ? h.get('content-type') : h['content-type'];
  return typeof v === 'string' ? v : null;
}

/**
 * Wrap an existing axios instance (with its own baseURL, interceptors, auth) into
 * a {@link Transport}. URL building, headers, the payload transformer, and error
 * mapping stay in `createFetcher`.
 *
 * @example
 * import axios from 'axios';
 * import { createFetcher, axiosTransport } from '@dudousxd/nestjs-client';
 * const http = axios.create({ baseURL: '/api', withCredentials: true });
 * const fetcher = createFetcher({ transport: axiosTransport(http) });
 *
 * Note: set the base URL on the axios instance (not `createFetcher.baseUrl`) to
 * avoid prefixing twice.
 */
export function axiosTransport(instance: AxiosLike): Transport {
  return async (req) => {
    const res = await instance.request({
      method: req.method,
      url: req.url,
      headers: req.headers,
      ...(req.body !== undefined ? { data: req.body } : {}),
      responseType: 'text',
      validateStatus: () => true,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText ?? '',
      contentType: readContentType(res.headers),
      text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
    };
  };
}
