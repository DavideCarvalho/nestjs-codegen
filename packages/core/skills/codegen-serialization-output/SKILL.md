---
name: codegen-serialization-output
description: >-
  Understand what @dudousxd/nestjs-codegen emits and how the serialization seam shapes response
  types. Covers the generated routes.ts (ROUTES, RouteName, RouteParams, the route() helper, @As
  name overrides), api.ts (createApi factory), and forms.ts (validation schemas), plus the
  serialization:'json'|'superjson' config. In 'json' (default) every response type is wrapped in
  Jsonify<...> (Date->string, bigint->never, methods dropped); 'superjson' emits the raw controller
  return type and MUST be paired with the /superjson runtime. Use when a Date arrives as a string,
  when choosing json vs superjson, or when wiring route() and the generated outputs.
metadata:
  type: core
  library: "@dudousxd/nestjs-codegen"
  library_version: 0.8.0
  framework: nestjs
---

# Generated output & serialization

A codegen run writes typed artifacts into `codegen.outDir`. The two that matter for every consumer
are `routes.ts` (typed URLs) and `api.ts` (the client factory); `forms.ts` carries validation
schemas. How response types are shaped depends on the `serialization` config.

## Setup

With the module wired (see the `codegen-setup` skill), a run emits e.g. `src/generated/routes.ts`,
`src/generated/api.ts`, and `src/generated/forms.ts`. Consume them like this:

```ts title="src/lib/api.ts"
import { createApi } from '../generated/api';
import { createFetcher } from '@dudousxd/nestjs-client';
import { route } from '../generated/routes';

export const api = createApi(createFetcher({ baseUrl: '/api' }));

route('users.show', { id: '42' });            // → '/users/42'
route('users.list', undefined, { page: 2 });  // → '/users?page=2'
```

## Core patterns

### 1. routes.ts is the typed URL source of truth

`routes.ts` exports a `ROUTES` map, a `RouteName` union, `RouteParams<K>`, and a runtime `route()`
helper that interpolates params and appends a query string:

```ts title="src/generated/routes.ts (emitted)"
export const ROUTES = {
  'users.list': '/users',
  'users.show': '/users/:id',
} as const;
export type RouteName = 'users.list' | 'users.show';
```

Route names are `<controllerSegment>.<method>` (e.g. `UsersController#list` → `users.list`). Override
either segment with `@As('…')` at the class or method level. A wrong/unknown route name is a type
error; a missing required param throws at runtime.
Source: `apps/docs/content/docs/client/routes.mdx`, `packages/core/src/emit/emit-routes.ts`,
`packages/core/src/discovery/contracts-fast.ts` (`getDecorator('As')`).

### 2. api.ts is a factory you inject the fetcher into

`api.ts` exports `createApi(fetcher)` and an `Api` type — never a hardcoded transport. You build the
client once with your fetcher; each leaf is an awaitable, fully-typed handle:

```ts
const users = await api.users.list();                 // typed response
const user  = await api.users.show({ params: { id } });
const made  = await api.users.create({ body });        // body typed from the DTO
```

Source: `apps/docs/content/docs/client/api-client.mdx`, `packages/core/src/emit/emit-api.ts`.

### 3. serialization decides the response type shape

`serialization` (config key, default `'json'`) controls whether the emitted `response` type models
the JSON wire shape or the raw server type:

```ts title="nestjs-codegen.config.ts"
export default defineConfig({
  // ...
  serialization: 'json',      // default: wrap responses in Jsonify<...>
  // serialization: 'superjson', // emit raw controller return types (revived at runtime)
});
```

`'json'` wraps every `response` in the type-only `Jsonify<...>` from `@dudousxd/nestjs-client`:
`Date` (and anything with `toJSON()`) → its serialized shape, arrays/objects recurse, non-serializable
props are dropped, `bigint` → `never`. It's a compile-time transform with no runtime cost. `body`,
`query`, `params`, and `error` are emitted as-is.
Source: `packages/core/src/config/types.ts` (`serialization`), `apps/docs/content/docs/client/api-client.mdx`.

## Common mistakes

### Treating a json-mode response as a runtime Date

```ts
// ❌ Wrong — controller returns { createdAt: Date }, but under serialization:'json' the wire is JSON
const u = await api.users.show({ params: { id } });
u.createdAt.getFullYear(); // type error: createdAt is `string` (Jsonify maps Date -> string)
```

```ts
// ✅ Correct — it's the ISO string the server actually sent
const u = await api.users.show({ params: { id } });
new Date(u.createdAt).getFullYear();
```

`JSON.stringify(new Date())` produces an ISO string, so `Jsonify` types `createdAt` as `string` to
stop the type from lying about the wire.
Source: `apps/docs/content/docs/client/api-client.mdx` ("Response types & serialization").

### Flipping serialization:'superjson' without the runtime

```ts
// ❌ Wrong — config emits raw Date types, but the client still parses plain JSON → values are strings
defineConfig({ serialization: 'superjson' });
// (no /superjson fetcher options, no SuperjsonInterceptor on the server)
```

```ts
// ✅ Correct — pair the config with the runtime that revives the types (see nestjs-client-runtime)
import { superjsonFetcherOptions } from '@dudousxd/nestjs-client/superjson';
createApi(createFetcher({ baseUrl: '/api', ...superjsonFetcherOptions() }));
// + register SuperjsonInterceptor on the server
```

`serialization:'superjson'` only turns OFF compile-time `Jsonify` wrapping; the actual revival of
`Date`/`Map`/`Set`/`BigInt` happens at runtime via the `/superjson` subpath and the server
interceptor. Without both, the types claim `Date` but the value is still a string.
Source: `apps/docs/content/docs/client/fetcher.mdx` ("superjson runtime"), `packages/client/src/superjson/index.ts`.

### Not gating generated drift in CI

```bash
# ❌ Wrong — generate but never check, so a stale committed client silently ships
npx nestjs-codegen codegen
```

```bash
# ✅ Correct — fail the build when the committed artifacts are stale
npx nestjs-codegen codegen
git diff --exit-code src/generated
```

The dev watcher is skipped in production, so the artifacts you ship are whatever is committed —
gate them or they drift from your routes.
Source: `apps/docs/content/docs/getting-started.mdx` ("Generate in CI").
