/* v8 ignore next 3 -- import resolution is not a branch */
import { ApiHttpError } from './errors.js';
import { getGlobalHeaders } from './global-headers.js';
import { buildUrl } from './url-builder.js';

/**
 * Payload transformer (the superjson integration point). Pass `superjson` (its
 * `{ stringify, parse }` matches this shape) to preserve rich types like `Date`,
 * `Map`, `Set`, and `BigInt` across the wire — the server must use the same
 * transformer. When omitted, plain JSON is used.
 */
export interface PayloadTransformer {
  stringify(value: unknown): string;
  parse<T>(text: string): T;
}

/**
 * Compose a pipeline of transformers. The first is the base serializer
 * (value → string, e.g. superjson); any following ones are string → string
 * wrappers (compression, encryption, …) applied left-to-right on `stringify`
 * and unwound right-to-left on `parse`. A single transformer is returned as-is.
 */
export function composeTransformers(transformers: PayloadTransformer[]): PayloadTransformer {
  if (transformers.length === 1) return transformers[0] as PayloadTransformer;
  return {
    stringify(value: unknown): string {
      let acc = (transformers[0] as PayloadTransformer).stringify(value);
      for (let i = 1; i < transformers.length; i++) {
        acc = (transformers[i] as PayloadTransformer).stringify(acc);
      }
      return acc;
    },
    parse<T>(text: string): T {
      let acc: unknown = text;
      for (let i = transformers.length - 1; i >= 1; i--) {
        acc = (transformers[i] as PayloadTransformer).parse(acc as string);
      }
      return (transformers[0] as PayloadTransformer).parse(acc as string);
    },
  };
}

/** A normalized HTTP request handed to a {@link Transport}. */
export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Serialized body (JSON string) or FormData; absent for bodyless requests. */
  body?: string | FormData;
}

/** A normalized HTTP response a {@link Transport} returns. */
export interface TransportResponse {
  ok: boolean;
  status: number;
  statusText: string;
  /** Value of the `content-type` response header, if any. */
  contentType: string | null;
  /** The raw response body as text. */
  text(): Promise<string>;
}

/**
 * The network layer. Defaults to native `fetch`. Provide your own to use a
 * different HTTP client (axios, got, ky, a mock in tests…) — URL building,
 * headers, the payload transformer, and error handling stay in `createFetcher`;
 * the transport only performs the call and normalizes the response.
 *
 * @example // axios transport
 * const transport: Transport = async (req) => {
 *   const res = await axios.request({
 *     method: req.method, url: req.url, headers: req.headers, data: req.body,
 *     responseType: 'text', validateStatus: () => true,
 *   });
 *   return {
 *     ok: res.status >= 200 && res.status < 300,
 *     status: res.status, statusText: res.statusText,
 *     contentType: res.headers['content-type'] ?? null,
 *     text: async () => res.data,
 *   };
 * };
 * createFetcher({ transport });
 */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface FetcherOptions {
  baseUrl?: string;
  /** Called once per request; allows dynamic auth tokens. */
  headers?: () => Record<string, string>;
  /** Custom network layer (axios, got, …). Defaults to native `fetch`. */
  transport?: Transport;
  /** fetch implementation for the default transport; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Invoked with the error before it is re-thrown. */
  onError?: (err: ApiHttpError) => void;
  /**
   * superjson (or any `{ stringify, parse }`) to transform request/response bodies.
   * Pass an array to compose a pipeline (base serializer first, then string→string
   * wrappers like compression/encryption). Bring your own — it's just an object.
   */
  transformer?: PayloadTransformer | PayloadTransformer[];
}

export interface Fetcher {
  get<T>(path: string, opts?: RequestOpts): Promise<T>;
  post<T>(path: string, opts?: RequestOpts): Promise<T>;
  put<T>(path: string, opts?: RequestOpts): Promise<T>;
  patch<T>(path: string, opts?: RequestOpts): Promise<T>;
  delete<T>(path: string, opts?: RequestOpts): Promise<T>;
  /**
   * Consume a server-sent-events (`@Sse()`) endpoint as a typed async stream.
   * Each yielded value is the JSON-parsed `data:` payload of one SSE event,
   * typed as `T` (the streamed element type the codegen carried through). The
   * stream ends when the connection closes; aborting the optional
   * {@link SseOpts.signal} stops it early.
   */
  sse<T>(path: string, opts?: SseOpts): AsyncIterable<T>;
}

/** Options for a streaming {@link Fetcher.sse} consumption. */
export interface SseOpts {
  params?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
  /** Abort the stream early. */
  signal?: AbortSignal;
}

interface RequestOpts {
  // `| undefined` (not just optional) so callers can pass an explicit `undefined` — the
  // generated client does `{ query: input?.query }` etc. and must stay clean under
  // `exactOptionalPropertyTypes`.
  params?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
}

function isFormData(b: unknown): b is FormData {
  return typeof FormData !== 'undefined' && b instanceof FormData;
}

/** Default transport: native fetch, normalizing the `Response` to a `TransportResponse`. */
function fetchTransport(fetchImpl: typeof fetch | undefined): Transport {
  return async (req) => {
    if (!fetchImpl) {
      throw new Error(
        'No fetch implementation: pass opts.fetch, opts.transport, or set globalThis.fetch',
      );
    }
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      ...(req.body !== undefined ? { body: req.body } : {}),
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get('content-type'),
      text: () => res.text(),
    };
  };
}

export function createFetcher(opts: FetcherOptions = {}): Fetcher {
  const baseUrl = opts.baseUrl ?? '';
  const transformer = Array.isArray(opts.transformer)
    ? opts.transformer.length > 0
      ? composeTransformers(opts.transformer)
      : undefined
    : opts.transformer;
  const transport = opts.transport ?? fetchTransport(opts.fetch ?? globalThis.fetch);

  async function request<T>(method: string, path: string, ro: RequestOpts = {}): Promise<T> {
    const url = buildUrl(path, ro, baseUrl);
    const headers: Record<string, string> = { ...getGlobalHeaders(), ...opts.headers?.() };
    let body: string | FormData | undefined;

    if (ro.body !== undefined) {
      if (isFormData(ro.body)) {
        body = ro.body;
        // Do NOT set Content-Type — the runtime sets it with the multipart boundary
      } else {
        body = transformer ? transformer.stringify(ro.body) : JSON.stringify(ro.body);
        headers['content-type'] = 'application/json';
      }
    }

    if (!headers.accept) {
      headers.accept = 'application/json';
    }

    const res = await transport({ method, url, headers, ...(body !== undefined ? { body } : {}) });

    if (!res.ok) {
      const ct = res.contentType ?? '';
      const rawBody = ct.includes('application/json')
        ? await res
            .text()
            .then((t) => safeJsonParse(t))
            .catch(() => null)
        : await res.text().catch(() => '');
      const err = new ApiHttpError(res.status, res.statusText, rawBody);
      opts.onError?.(err);
      throw err;
    }

    if (res.status === 204) return undefined as T;

    const ct = res.contentType ?? '';
    const text = await res.text();
    if (ct.includes('application/json')) {
      return transformer ? transformer.parse<T>(text) : (JSON.parse(text) as T);
    }
    return text as unknown as T;
  }

  const fetchImpl = opts.fetch ?? globalThis.fetch;

  function sse<T>(path: string, so: SseOpts = {}): AsyncIterable<T> {
    const url = buildUrl(
      path,
      { ...(so.params ? { params: so.params } : {}), ...(so.query ? { query: so.query } : {}) },
      baseUrl,
    );
    const headers: Record<string, string> = {
      ...getGlobalHeaders(),
      ...opts.headers?.(),
      accept: 'text/event-stream',
    };
    return consumeSse<T>(fetchImpl, url, headers, transformer, so.signal);
  }

  return {
    get: <T>(p: string, ro?: RequestOpts) => request<T>('GET', p, ro),
    post: <T>(p: string, ro?: RequestOpts) => request<T>('POST', p, ro),
    put: <T>(p: string, ro?: RequestOpts) => request<T>('PUT', p, ro),
    patch: <T>(p: string, ro?: RequestOpts) => request<T>('PATCH', p, ro),
    delete: <T>(p: string, ro?: RequestOpts) => request<T>('DELETE', p, ro),
    sse,
  };
}

/**
 * Consume a `text/event-stream` response as an async iterable of parsed `data:`
 * payloads. Parses the SSE wire format (events separated by a blank line, `data:`
 * lines concatenated) and JSON-parses each event's data via the transformer when
 * present (else `JSON.parse`). Bring-your-own-`fetch` so it works in any runtime.
 */
export async function* consumeSse<T>(
  fetchImpl: typeof fetch | undefined,
  url: string,
  headers: Record<string, string>,
  transformer: PayloadTransformer | undefined,
  signal?: AbortSignal,
): AsyncIterable<T> {
  if (!fetchImpl) {
    throw new Error('No fetch implementation: pass opts.fetch or set globalThis.fetch');
  }
  const res = await fetchImpl(url, {
    method: 'GET',
    headers,
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiHttpError(res.status, res.statusText, safeJsonParse(body) ?? body);
  }
  const body = res.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const parse = (data: string): T =>
    transformer ? transformer.parse<T>(data) : (JSON.parse(data) as T);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Events are separated by a blank line.
      let sep = buf.indexOf('\n\n');
      while (sep !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const data = parseEventData(raw);
        if (data !== null) yield parse(data);
        sep = buf.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Extract and concatenate the `data:` lines of one SSE event block. */
function parseEventData(block: string): string | null {
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
