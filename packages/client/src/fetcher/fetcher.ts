/* v8 ignore next 3 -- import resolution is not a branch */
import { ApiHttpError } from './errors.js';
import { getGlobalHeaders } from './global-headers.js';
import { type ArrayQueryFormat, buildUrl } from './url-builder.js';

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

/**
 * How a {@link Transport} should materialize the response body. `'json'`/`'text'`
 * both read the body as text (the fetcher then parses JSON itself), `'blob'`
 * returns a `Blob`, and `'arrayBuffer'` returns an `ArrayBuffer`. Defaults to
 * text on the JSON path, so existing transports/callers are unaffected.
 */
export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer';

/**
 * Upload-progress callback for multipart/FormData bodies. `loaded` is the bytes
 * sent so far and `total` the full body size when the transport can determine it
 * (it may be `undefined`). Only the {@link axiosTransport} reports progress; the
 * native-`fetch` transport cannot and ignores it.
 */
export type UploadProgressHandler = (progress: { loaded: number; total?: number }) => void;

/** A normalized HTTP request handed to a {@link Transport}. */
export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Serialized body (JSON string) or FormData; absent for bodyless requests. */
  body?: string | FormData;
  /**
   * Desired response materialization. Absent means text (the JSON path). A
   * transport that does not support a given type should fall back to text.
   */
  responseType?: ResponseType;
  /**
   * Report upload progress for a FormData body. Optional; a transport that
   * cannot observe upload progress (native `fetch`) ignores it.
   */
  onUploadProgress?: UploadProgressHandler;
}

/** A normalized HTTP response a {@link Transport} returns. */
export interface TransportResponse {
  ok: boolean;
  status: number;
  statusText: string;
  /** Value of the `content-type` response header, if any. */
  contentType: string | null;
  /**
   * All response headers, lower-cased keys. Lets callers read e.g.
   * `content-disposition` (original download filename) or `x-auth-token`.
   * Optional for back-compat: transports written before this field still
   * satisfy the contract, and `contentType` remains the source of truth for
   * content-type detection.
   */
  headers?: Record<string, string>;
  /** The raw response body as text. */
  text(): Promise<string>;
  /**
   * The raw response body as a `Blob`. Present only when the request asked for
   * `responseType: 'blob'`; transports may omit it otherwise.
   */
  blob?(): Promise<Blob>;
  /**
   * The raw response body as an `ArrayBuffer`. Present only when the request
   * asked for `responseType: 'arrayBuffer'`; transports may omit it otherwise.
   */
  arrayBuffer?(): Promise<ArrayBuffer>;
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
  /**
   * Transforms the parsed JSON response body before it is returned. Applied
   * only to `application/json` responses (not the text fallback or SSE).
   * Serialization-agnostic seam: the `/superjson` subpath supplies
   * `superjson.deserialize` here to revive `Date`/`Map`/`Set` etc. Default
   * identity, so plain-JSON consumers are unaffected.
   */
  deserialize?: (raw: unknown) => unknown;
  /**
   * How array-valued query params are serialized for every request. `'comma'`
   * (default) → `?ids=a,b`; `'repeat'` → `?ids=a&ids=b` (the form Nest's default
   * query parser revives as a `string[]`). A per-request `arrayFormat` overrides
   * this default. See {@link ArrayQueryFormat}.
   */
  arrayFormat?: ArrayQueryFormat;
}

/**
 * A raw response returned by the binary/escape-hatch methods: the materialized
 * `data` (a `Blob`/`ArrayBuffer`/parsed-JSON/text depending on `responseType`)
 * plus the `status` and all response `headers` (lower-cased keys) so callers can
 * read `content-disposition`, `x-auth-token`, etc. No `superjson`/`deserialize`
 * runs on a blob/arrayBuffer body.
 */
export interface RawResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
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
  /**
   * Escape hatch for binary downloads: issues the request with
   * `responseType: 'blob'` and resolves to the raw `Blob` plus response
   * `status`/`headers`. Use the headers to read `content-disposition` (original
   * filename) or `x-auth-token`. `superjson`/`deserialize` never runs on the
   * body. Defaults to `GET`; pass `method` for downloads behind another verb.
   */
  fetchBlob(path: string, opts?: RawRequestOpts): Promise<RawResponse<Blob>>;
  /**
   * General escape hatch: like the verb methods but returns the full
   * {@link RawResponse} (`data`/`status`/`headers`). `responseType` (default
   * `'json'`) selects how the body is materialized — `'json'`/`'text'` go
   * through the normal parse path; `'blob'`/`'arrayBuffer'` bypass
   * `deserialize`. Supports `onUploadProgress` for FormData uploads (honored by
   * {@link axiosTransport}; ignored by the native-`fetch` transport).
   */
  fetchRaw<T>(path: string, opts?: RawRequestOpts): Promise<RawResponse<T>>;
}

/** Options for a streaming {@link Fetcher.sse} consumption. */
export interface SseOpts {
  params?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
  /** Abort the stream early. */
  signal?: AbortSignal;
  /** Override the fetcher's array query-param serialization for this stream. */
  arrayFormat?: ArrayQueryFormat | undefined;
}

interface RequestOpts {
  // `| undefined` (not just optional) so callers can pass an explicit `undefined` — the
  // generated client does `{ query: input?.query }` etc. and must stay clean under
  // `exactOptionalPropertyTypes`.
  params?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  /** Override the fetcher's array query-param serialization for this request. */
  arrayFormat?: ArrayQueryFormat | undefined;
  /**
   * Serialize `body` as `multipart/form-data` instead of JSON. The generated
   * client sets this for routes whose handler takes an `@UploadedFile()`. Each
   * own-property of the body object becomes a form field; `File`/`Blob` values
   * (and arrays of them) ride as file parts, scalars as strings, `Date` as ISO.
   */
  multipart?: boolean | undefined;
}

/** Options for the {@link Fetcher.fetchRaw} / {@link Fetcher.fetchBlob} escape hatches. */
interface RawRequestOpts extends RequestOpts {
  /** HTTP method; defaults to `'GET'` for `fetchBlob`, `'GET'` for `fetchRaw`. */
  method?: string | undefined;
  /** How to materialize the body. `fetchBlob` forces `'blob'`. */
  responseType?: ResponseType | undefined;
  /** Upload-progress callback for FormData bodies (axios transport only). */
  onUploadProgress?: UploadProgressHandler | undefined;
}

function isFormData(b: unknown): b is FormData {
  return typeof FormData !== 'undefined' && b instanceof FormData;
}

function isBlobLike(v: unknown): v is Blob {
  // `File` extends `Blob`, so this covers both browser file inputs and Blobs.
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

/** Append one value to a FormData field, picking the right encoding for its type. */
function appendFormValue(fd: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (isBlobLike(value)) {
    fd.append(key, value);
  } else if (value instanceof Date) {
    fd.append(key, value.toISOString());
  } else if (typeof value === 'object') {
    // A nested object can't ride a flat multipart field; JSON-encode it.
    fd.append(key, JSON.stringify(value));
  } else {
    fd.append(key, String(value));
  }
}

/**
 * Build a `FormData` from a plain body object for a multipart upload. Array
 * values are appended as repeated parts (one per element), so a `File[]` field
 * arrives as multiple file parts under the same name.
 */
function toFormData(body: unknown): FormData {
  const fd = new FormData();
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) appendFormValue(fd, key, item);
      } else {
        appendFormValue(fd, key, value);
      }
    }
  }
  return fd;
}

/** Collect a `Headers` instance into a plain lower-cased-key record. */
function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Default transport: native fetch, normalizing the `Response` to a `TransportResponse`. */
function fetchTransport(fetchImpl: typeof fetch | undefined): Transport {
  return async (req) => {
    if (!fetchImpl) {
      throw new Error(
        'No fetch implementation: pass opts.fetch, opts.transport, or set globalThis.fetch',
      );
    }
    // Native fetch cannot report upload progress; if a caller asked for it, that
    // is a no-op here (axiosTransport honors it). Nothing to do.
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
      headers: headersToRecord(res.headers),
      text: () => res.text(),
      blob: () => res.blob(),
      arrayBuffer: () => res.arrayBuffer(),
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

  /** Build headers + body for a request, sending the transport call and mapping non-2xx. */
  async function send(
    method: string,
    path: string,
    ro: RawRequestOpts,
  ): Promise<TransportResponse> {
    // Per-request `arrayFormat` wins over the fetcher-level default.
    const url = buildUrl(path, { ...ro, arrayFormat: ro.arrayFormat ?? opts.arrayFormat }, baseUrl);
    const headers: Record<string, string> = { ...getGlobalHeaders(), ...opts.headers?.() };
    let body: string | FormData | undefined;

    if (ro.body !== undefined) {
      if (isFormData(ro.body)) {
        body = ro.body;
        // Do NOT set Content-Type — the runtime sets it with the multipart boundary
      } else if (ro.multipart) {
        // Multipart upload: serialize the body object to FormData and let the
        // runtime set the multipart boundary Content-Type.
        body = toFormData(ro.body);
      } else {
        body = transformer ? transformer.stringify(ro.body) : JSON.stringify(ro.body);
        headers['content-type'] = 'application/json';
      }
    }

    if (!headers.accept) {
      headers.accept = 'application/json';
    }

    const res = await transport({
      method,
      url,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(ro.responseType !== undefined ? { responseType: ro.responseType } : {}),
      ...(ro.onUploadProgress !== undefined ? { onUploadProgress: ro.onUploadProgress } : {}),
    });

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

    return res;
  }

  async function request<T>(method: string, path: string, ro: RequestOpts = {}): Promise<T> {
    const res = await send(method, path, ro);

    if (res.status === 204) return undefined as T;

    const ct = res.contentType ?? '';
    const text = await res.text();
    if (ct.includes('application/json')) {
      const parsed: unknown = transformer ? transformer.parse<unknown>(text) : JSON.parse(text);
      return (opts.deserialize ? opts.deserialize(parsed) : parsed) as T;
    }
    return text as unknown as T;
  }

  /**
   * Raw escape hatch: materialize the body per `responseType` (default `'json'`)
   * and return it alongside `status` + lower-cased `headers`. Blob/arrayBuffer
   * bodies bypass `transformer.parse` and `deserialize` entirely — they are
   * returned untouched.
   */
  async function requestRaw<T>(
    method: string,
    path: string,
    ro: RawRequestOpts = {},
  ): Promise<RawResponse<T>> {
    const res = await send(method, path, ro);
    const headers = res.headers ?? {};

    const responseType = ro.responseType ?? 'json';
    if (responseType === 'blob') {
      if (!res.blob) {
        throw new Error("Transport does not support responseType: 'blob'");
      }
      return { data: (await res.blob()) as T, status: res.status, headers };
    }
    if (responseType === 'arrayBuffer') {
      if (!res.arrayBuffer) {
        throw new Error("Transport does not support responseType: 'arrayBuffer'");
      }
      return { data: (await res.arrayBuffer()) as T, status: res.status, headers };
    }

    if (res.status === 204) {
      return { data: undefined as T, status: res.status, headers };
    }
    const ct = res.contentType ?? '';
    const text = await res.text();
    if (responseType === 'text') {
      return { data: text as T, status: res.status, headers };
    }
    // 'json'
    if (ct.includes('application/json')) {
      const parsed: unknown = transformer ? transformer.parse<unknown>(text) : JSON.parse(text);
      return {
        data: (opts.deserialize ? opts.deserialize(parsed) : parsed) as T,
        status: res.status,
        headers,
      };
    }
    return { data: text as unknown as T, status: res.status, headers };
  }

  const fetchImpl = opts.fetch ?? globalThis.fetch;

  function sse<T>(path: string, so: SseOpts = {}): AsyncIterable<T> {
    const arrayFormat = so.arrayFormat ?? opts.arrayFormat;
    const url = buildUrl(
      path,
      {
        ...(so.params ? { params: so.params } : {}),
        ...(so.query ? { query: so.query } : {}),
        ...(arrayFormat ? { arrayFormat } : {}),
      },
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
    fetchBlob: (p: string, ro: RawRequestOpts = {}) =>
      requestRaw<Blob>(ro.method ?? 'GET', p, { ...ro, responseType: 'blob' }),
    fetchRaw: <T>(p: string, ro: RawRequestOpts = {}) => requestRaw<T>(ro.method ?? 'GET', p, ro),
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
