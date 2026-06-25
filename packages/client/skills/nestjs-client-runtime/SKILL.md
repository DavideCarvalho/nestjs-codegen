---
name: nestjs-client-runtime
description: >-
  Use @dudousxd/nestjs-client, the framework-neutral runtime the generated api.ts imports from.
  Build the client with createApi(createFetcher(opts)); configure FetcherOptions
  (baseUrl, headers, transport, transformer, deserialize, onError). Swap the network layer with
  axiosTransport(instance) or a custom Transport (returns normalized { ok,status,statusText,text() },
  NOT a parsed body). Round-trip rich types with a transformer ({ stringify, parse }) or an array
  pipeline via composeTransformers. Opt individual clients into superjson with the
  @dudousxd/nestjs-client/superjson subpath: superjsonFetcherOptions, withSuperjson, and the server
  SuperjsonInterceptor. Handles errors via ApiHttpError. Use for fetcher wiring, axios, superjson, auth headers.
metadata:
  type: core
  library: "@dudousxd/nestjs-client"
  library_version: 0.6.0
  framework: nestjs
---

# nestjs-client runtime

`@dudousxd/nestjs-client` is the runtime the generated `api.ts` calls. `createFetcher` owns URL
building, headers, error mapping (`ApiHttpError`), and the payload transformer; the actual network
call is a pluggable `Transport`. You inject the fetcher into the generated `createApi(fetcher)`.

## Setup

```bash
pnpm add @dudousxd/nestjs-client
```

```ts title="src/lib/api.ts"
import { createApi } from '../generated/api';
import { createFetcher } from '@dudousxd/nestjs-client';

export const api = createApi(
  createFetcher({
    baseUrl: '/api',
    headers: () => ({ authorization: `Bearer ${getToken()}` }), // called once per request
  }),
);
```

`headers` is a function so tokens stay dynamic. Each generated leaf is awaitable: `await api.users.list()`.

## Core patterns

### 1. Swap the transport (axios) without touching call sites

The default transport is native `fetch`. Pass `transport` to use your own HTTP client:

```ts
import axios from 'axios';
import { createFetcher, axiosTransport } from '@dudousxd/nestjs-client';

const http = axios.create({ baseURL: '/api', withCredentials: true });
const fetcher = createFetcher({ transport: axiosTransport(http) });
```

For anything else, a `Transport` takes a normalized request and returns a normalized response —
`createFetcher` keeps URL building, headers, transformer, and error handling:

```ts
import type { Transport } from '@dudousxd/nestjs-client';

const transport: Transport = async (req) => {
  const res = await myClient(req.url, { method: req.method, headers: req.headers, body: req.body });
  return {
    ok: res.ok, status: res.status, statusText: res.statusText,
    contentType: res.headers.get('content-type'),
    text: () => res.text(),
  };
};
createFetcher({ transport });
```

Source: `apps/docs/content/docs/client/fetcher.mdx`, `packages/client/src/fetcher/fetcher.ts`
(`Transport`, `TransportResponse`), `packages/client/src/transports/axios.ts`.

### 2. Transformers round-trip rich types

A `transformer` is a `{ stringify, parse }` pair applied to both request and response bodies — the
server must speak the same one. Pass an array to compose a pipeline (base value↔string serializer
first, then string↔string wrappers like compression, applied left-to-right and unwound on parse):

```ts
import superjson from 'superjson';
import { createFetcher } from '@dudousxd/nestjs-client';
import { compress } from './my-compress'; // { stringify, parse } over strings

createFetcher({ transformer: superjson });            // single
createFetcher({ transformer: [superjson, compress] }); // composed pipeline
```

Source: `packages/client/src/fetcher/fetcher.ts` (`PayloadTransformer`, `composeTransformers`,
`FetcherOptions.transformer`).

### 3. Per-consumer superjson via the /superjson subpath

The global `transformer` changes serialization for BOTH directions for EVERY consumer (an atomic
cross-app flip). To revive rich types in responses while letting each client opt in independently,
use the `/superjson` subpath — it sends `x-superjson: 1` and supplies a `deserialize` hook; the
server's `SuperjsonInterceptor` only superjson-serializes responses that carry the header:

```ts title="src/lib/api.ts"
import { createApi } from '../generated/api';
import { createFetcher } from '@dudousxd/nestjs-client';
import { superjsonFetcherOptions } from '@dudousxd/nestjs-client/superjson';

export const api = createApi(createFetcher({ baseUrl: '/api', ...superjsonFetcherOptions() }));
```

```ts title="src/app.module.ts"
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SuperjsonInterceptor } from '@dudousxd/nestjs-client/superjson';

@Module({ providers: [{ provide: APP_INTERCEPTOR, useClass: SuperjsonInterceptor }] })
export class AppModule {}
```

`superjson`, `rxjs`, and `@nestjs/common` are optional peers pulled in only by `/superjson`.
Source: `packages/client/src/superjson/index.ts`, `apps/docs/content/docs/client/fetcher.mdx`.

## Common mistakes

### Double-prefixing the base URL with axios

```ts
// ❌ Wrong — baseURL on the axios instance AND baseUrl on createFetcher → '/api/api/users'
const http = axios.create({ baseURL: '/api' });
createFetcher({ baseUrl: '/api', transport: axiosTransport(http) });
```

```ts
// ✅ Correct — set the base URL in exactly one place (the axios instance)
const http = axios.create({ baseURL: '/api' });
createFetcher({ transport: axiosTransport(http) });
```

`createFetcher.baseUrl` and the axios `baseURL` both prepend, so setting both prefixes the path
twice.
Source: `apps/docs/content/docs/client/fetcher.mdx` ("Set the base URL on the axios instance").

### Dropping your auth headers when adding superjson

```ts
// ❌ Wrong — spreading superjsonFetcherOptions() over your own headers replaces them
createFetcher({ headers: () => ({ authorization: token() }), ...superjsonFetcherOptions() });
// superjsonFetcherOptions() supplies its own `headers`, clobbering authorization
```

```ts
// ✅ Correct — withSuperjson() composes your headers with the x-superjson opt-in
import { withSuperjson } from '@dudousxd/nestjs-client/superjson';
createFetcher(withSuperjson({ baseUrl: '/api', headers: () => ({ authorization: token() }) }));
```

`superjsonFetcherOptions()` returns its own `headers`; spreading it last overwrites yours.
`withSuperjson()` merges both so the opt-in header and your auth are sent together.
Source: `packages/client/src/superjson/index.ts` (`withSuperjson`, `superjsonFetcherOptions`).

### Returning the parsed body from a custom Transport

```ts
// ❌ Wrong — a Transport must NOT parse JSON; returning the object breaks the transformer/error path
const transport: Transport = async (req) => await fetch(req.url).then((r) => r.json());
```

```ts
// ✅ Correct — return the normalized response; createFetcher reads text() and parses/transforms
const transport: Transport = async (req) => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  return { ok: res.ok, status: res.status, statusText: res.statusText,
           contentType: res.headers.get('content-type'), text: () => res.text() };
};
```

The fetcher parses JSON and runs the transformer itself; a `Transport` only performs the call and
hands back `{ ok, status, statusText, contentType, text() }`.
Source: `packages/client/src/fetcher/fetcher.ts` (`Transport`, `TransportResponse`).
