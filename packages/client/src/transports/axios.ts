import type { ResponseType, Transport, UploadProgressHandler } from '../fetcher/fetcher.js';

/** Config passed to the underlying axios instance — mirrors the subset we use. */
interface AxiosRequestConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  data?: string | FormData;
  responseType: 'text' | 'blob' | 'arraybuffer';
  validateStatus: (status: number) => boolean;
  onUploadProgress?: (event: { loaded: number; total?: number }) => void;
}

/** Minimal structural shape of an axios instance — your real instance fits this. */
export interface AxiosLike {
  request(config: AxiosRequestConfig): Promise<{
    status: number;
    statusText?: string;
    data: unknown;
    headers: Record<string, unknown> | { get?(name: string): unknown };
  }>;
}

/** Collect axios response headers into a plain lower-cased-key record. */
function readAllHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== 'object') return out;
  // AxiosHeaders exposes `.toJSON()`; a plain object is iterated directly.
  const source = headers as { toJSON?(): Record<string, unknown> } & Record<string, unknown>;
  const entries = typeof source.toJSON === 'function' ? source.toJSON() : source;
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === 'string') {
      out[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      out[key.toLowerCase()] = value.join(', ');
    }
  }
  return out;
}

function readHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as { get?(n: string): unknown };
  // AxiosHeaders supports `.get()`; otherwise normalize then read by lower-cased key.
  if (typeof h.get === 'function') {
    const value = h.get(name);
    return typeof value === 'string' ? value : null;
  }
  return readAllHeaders(headers)[name.toLowerCase()] ?? null;
}

/** Map the neutral {@link ResponseType} onto axios's `responseType` spelling. */
function toAxiosResponseType(
  responseType: ResponseType | undefined,
): AxiosRequestConfig['responseType'] {
  if (responseType === 'blob') return 'blob';
  if (responseType === 'arrayBuffer') return 'arraybuffer';
  // 'json' and 'text' both read text — the fetcher parses JSON itself.
  return 'text';
}

/**
 * Wrap an existing axios instance (with its own baseURL, interceptors, auth) into
 * a {@link Transport}. URL building, headers, the payload transformer, and error
 * mapping stay in `createFetcher`.
 *
 * Unlike the native-`fetch` transport, this honors `onUploadProgress` (forwarded
 * to axios) and serves blob / arrayBuffer responses, so it is the transport to
 * use for file downloads and multipart uploads with progress.
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
    const responseType = toAxiosResponseType(req.responseType);
    const onUploadProgress: UploadProgressHandler | undefined = req.onUploadProgress;
    const res = await instance.request({
      method: req.method,
      url: req.url,
      headers: req.headers,
      ...(req.body !== undefined ? { data: req.body } : {}),
      responseType,
      validateStatus: () => true,
      ...(onUploadProgress
        ? {
            onUploadProgress: (event: { loaded: number; total?: number }) =>
              onUploadProgress({
                loaded: event.loaded,
                ...(event.total !== undefined ? { total: event.total } : {}),
              }),
          }
        : {}),
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText ?? '',
      contentType: readHeader(res.headers, 'content-type'),
      headers: readAllHeaders(res.headers),
      text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
      blob: async () => res.data as Blob,
      arrayBuffer: async () => res.data as ArrayBuffer,
    };
  };
}
