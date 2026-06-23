---
"@dudousxd/nestjs-client": minor
---

Add an opt-in superjson runtime, content-negotiated via the `x-superjson` header.

- **`FetcherOptions.deserialize?`** — a new generic `(raw: unknown) => unknown` hook applied to the parsed body of `application/json` responses only (never the text fallback or SSE). It's a no-op when absent, so plain-JSON consumers are unaffected.
- **New `@dudousxd/nestjs-client/superjson` subpath** isolating the optional `superjson`/`rxjs`/`@nestjs/common` peers:
  - `SUPERJSON_HEADER` (`'x-superjson'`).
  - `superjsonFetcherOptions()` — returns `{ headers, deserialize }` that sends the `x-superjson: 1` opt-in header and revives the response via `superjson.deserialize`.
  - `withSuperjson(opts)` — merges the superjson options into existing `FetcherOptions`, composing any caller `headers()`.
  - `SuperjsonInterceptor` — a NestJS interceptor that superjson-serializes the response into the `{ json, meta }` envelope ONLY when the request carries `x-superjson: 1`, otherwise passes through untouched. This makes superjson adoptable per-consumer with no atomic cross-app flip.
- `superjson` and `rxjs` are declared as optional peer dependencies.
