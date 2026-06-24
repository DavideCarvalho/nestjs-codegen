/* v8 ignore next -- import resolution is not a branch */
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import superjson from 'superjson';
import type { FetcherOptions } from '../fetcher/fetcher.js';

/**
 * Metadata key NestJS stamps onto an `@Sse()` route handler.
 *
 * The `@Sse` decorator calls `Reflect.defineMetadata('__sse__', true,
 * descriptor.value)` (see `@nestjs/common/decorators/http/sse.decorator`), i.e.
 * it tags the handler *function* — which is exactly what
 * `ExecutionContext.getHandler()` returns. NestJS also exports this as
 * `SSE_METADATA` from the internal `@nestjs/common/constants` module, but that
 * is not part of the package's public entrypoint, so we inline the literal
 * rather than import a deep internal path (and to avoid pulling in `Reflector`
 * from `@nestjs/core`, which would add a new peer dependency).
 */
const SSE_METADATA = '__sse__';

/**
 * Header the client sends to opt in to superjson serialization. The server
 * interceptor only superjson-serializes responses when this header is present,
 * so plain-JSON consumers are never affected.
 */
export const SUPERJSON_HEADER = 'x-superjson';

/**
 * Fetcher options that make a {@link createFetcher} consumer speak superjson:
 * it sends the `x-superjson: 1` opt-in header and revives the response body via
 * `superjson.deserialize` (restoring `Date`/`Map`/`Set`/`BigInt` etc.).
 *
 * @example
 * import { createFetcher } from '@dudousxd/nestjs-client';
 * import { superjsonFetcherOptions } from '@dudousxd/nestjs-client/superjson';
 *
 * export const fetcher = createFetcher({ baseUrl: '/api', ...superjsonFetcherOptions() });
 */
export function superjsonFetcherOptions(): Pick<FetcherOptions, 'headers' | 'deserialize'> {
  return {
    headers: () => ({ [SUPERJSON_HEADER]: '1' }),
    deserialize: (raw) => superjson.deserialize(raw as Parameters<typeof superjson.deserialize>[0]),
  };
}

/**
 * Merge {@link superjsonFetcherOptions} into an existing {@link FetcherOptions},
 * composing any caller-supplied `headers()` with the superjson opt-in header so
 * both sets of headers are sent.
 *
 * @example
 * createFetcher(withSuperjson({ baseUrl: '/api', headers: () => ({ authorization }) }))
 */
export function withSuperjson(opts: FetcherOptions = {}): FetcherOptions {
  const callerHeaders = opts.headers;
  return {
    ...opts,
    deserialize: (raw) => superjson.deserialize(raw as Parameters<typeof superjson.deserialize>[0]),
    headers: () => ({ ...callerHeaders?.(), [SUPERJSON_HEADER]: '1' }),
  };
}

/**
 * True when `payload` is a binary/streaming response that the HTTP layer must
 * emit as raw bytes, so it must NEVER be wrapped in a superjson `{ json, meta }`
 * envelope.
 *
 * Wrapping any of these would corrupt the response: a {@link StreamableFile} or
 * Node `Readable` would be mangled into a meaningless object, and a `Buffer`
 * (which superjson can technically encode) would be turned into a base64
 * envelope the client's `superjson.deserialize` is never asked to revive —
 * file/stream/buffer downloads are consumed as raw bytes by the caller, not
 * parsed as JSON by the codegen fetcher.
 *
 * Detection is intentionally duck-typed for the stream case
 * (`typeof payload.pipe === 'function'`) so it catches any Node `Readable`
 * subclass without importing `node:stream` into this browser-safe entrypoint.
 */
function isRawBinaryPayload(payload: unknown): boolean {
  if (payload instanceof StreamableFile) {
    return true;
  }
  if (Buffer.isBuffer(payload)) {
    return true;
  }
  // Node `Readable` stream (duck-typed): any object exposing a `.pipe()`.
  return (
    payload != null &&
    typeof payload === 'object' &&
    typeof (payload as { pipe?: unknown }).pipe === 'function'
  );
}

/**
 * NestJS interceptor that superjson-serializes a response into the
 * `{ json, meta }` envelope — but ONLY when the incoming request carries the
 * `x-superjson: 1` header. Requests without it pass through untouched (plain
 * JSON), so superjson can be adopted per-consumer with no atomic cross-app flip.
 *
 * Even when the header IS present, the interceptor only envelopes plain
 * JSON-serializable payloads (objects/arrays/primitives/`null`/`undefined`).
 * Responses that the HTTP layer streams as raw bytes are passed through
 * untouched, because superjson-wrapping them would break the wire format:
 *  - **`@Sse()` handlers** — the route emits a stream of `MessageEvent`s that
 *    Nest writes as the `text/event-stream` protocol; per-event
 *    `superjson.serialize` rewraps each into `{ json, meta }` and destroys the
 *    SSE framing, so SSE routes short-circuit before the `map()` entirely.
 *  - **{@link StreamableFile} / Node `Readable` / `Buffer`** — file downloads
 *    and binary responses are emitted as raw bytes; the codegen fetcher only
 *    runs `superjson.deserialize` on JSON bodies it parses, so passing these
 *    through unchanged is correct (see {@link isRawBinaryPayload}).
 *
 * Reachable only via `@dudousxd/nestjs-client/superjson` so the optional
 * `superjson` peer dependency stays isolated from plain-JSON users.
 */
@Injectable()
export class SuperjsonInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const marker = request?.headers?.[SUPERJSON_HEADER];
    const wantsSuperjson = (Array.isArray(marker) ? marker[0] : marker) === '1';

    if (!wantsSuperjson) {
      return next.handle();
    }

    // SSE guard: `@Sse()` tags the handler function with the `__sse__` metadata.
    // Its response is a `MessageEvent` stream, not a single JSON body — never
    // pipe a serialize `map` over it, or the event-stream protocol breaks.
    const isSseHandler = Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true;
    if (isSseHandler) {
      return next.handle();
    }

    return next
      .handle()
      .pipe(
        map((payload: unknown) =>
          isRawBinaryPayload(payload) ? payload : superjson.serialize(payload),
        ),
      );
  }
}
