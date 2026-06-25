---
name: tanstack-query-extension
description: >-
  Add the optional TanStack Query layer to @dudousxd/nestjs-codegen with tanstackQuery() from
  @dudousxd/nestjs-codegen-tanstack. Register it in NestjsCodegenModule.forRoot({ extensions:
  [tanstackQuery()] }) (or defineConfig). Point TanstackQueryOptions.import at your framework adapter
  (@tanstack/react-query default, or @tanstack/vue-query/-svelte-query/-solid-query); pageParamName
  names the infinite-query page field. Each api.ts leaf then exposes .queryOptions() (GET routes) /
  .mutationOptions() (writes) / .infiniteQueryOptions() (GET) / .queryKey(), while still being a
  plain awaitable request. Use when wiring TanStack Query, picking the framework import, or invalidating
  with queryKey().
metadata:
  type: core
  library: "@dudousxd/nestjs-codegen-tanstack"
  library_version: 0.4.1
  framework: nestjs
---

# TanStack Query extension

TanStack Query is an **extension**, not a core flag. By default the generated client is a plain
typed fetch with no TanStack dependency. Register `tanstackQuery()` and each `api.ts` leaf
additionally carries `queryOptions`/`mutationOptions`/`infiniteQueryOptions`/`queryKey` from your
framework adapter — the leaf stays awaitable for direct requests.

## Setup

```bash
pnpm add -D @dudousxd/nestjs-codegen-tanstack
# your framework adapter re-exports the helpers (you almost certainly have it):
pnpm add @tanstack/react-query   # or @tanstack/vue-query / -svelte-query / -solid-query
```

Register the extension where you configure the codegen (module or `defineConfig` file):

```ts title="src/app.module.ts"
import { NestjsCodegenModule } from '@dudousxd/nestjs-codegen/nest';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';

NestjsCodegenModule.forRoot({
  contracts: { glob: 'src/**/*.controller.ts' },
  codegen: { outDir: 'src/generated' },
  validation: zodAdapter,
  extensions: [tanstackQuery()], // import defaults to '@tanstack/react-query'
});
```

## Core patterns

### 1. Point `import` at YOUR framework adapter

You don't install `@tanstack/query-core` directly — your framework adapter re-exports
`queryOptions`/`mutationOptions`. Set `TanstackQueryOptions.import` to the package you have:

```ts
tanstackQuery();                                  // React (default)
tanstackQuery({ import: '@tanstack/vue-query' });
tanstackQuery({ import: '@tanstack/svelte-query' });
tanstackQuery({ import: '@tanstack/solid-query' });
```

Source: `packages/tanstack/src/index.ts` (`TanstackQueryOptions.import`, default `'@tanstack/react-query'`),
`apps/docs/content/docs/client/tanstack-query.mdx`.

### 2. GET → query helpers, writes → mutation helpers

The same leaf exposes different helpers by HTTP verb. GET routes get `.queryOptions()`,
`.infiniteQueryOptions()`, and `.queryKey()`; everything else gets `.mutationOptions()`:

```tsx
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

function Users() {
  const qc = useQueryClient();
  const list  = useQuery(api.users.list().queryOptions());
  const pages = useInfiniteQuery(api.users.list().infiniteQueryOptions());
  const create = useMutation({
    ...api.users.create().mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: api.users.list().queryKey() }),
  });
  const direct = api.users.show({ params: { id } }); // still a plain awaitable request
}
```

`queryKey()` derives a stable key from the route name + input, so it's the canonical key for
invalidation. Each helper returns a real options object you spread your own `onSuccess`/`select`/
`staleTime` into.
Source: `apps/docs/content/docs/client/tanstack-query.mdx`, `packages/tanstack/src/index.ts`.

### 3. Configure the infinite-query page field

`infiniteQueryOptions()` appends a page param and reads the next page from `response.meta.page` /
`response.meta.lastPage`. The field name is structural (baked into the emitted `queryFn`), so set it
at generation time for cursor-style APIs:

```ts
tanstackQuery({ pageParamName: 'cursor' }); // default 'page'
```

Source: `packages/tanstack/src/index.ts` (`TanstackQueryOptions.pageParamName`, default `'page'`).

## Common mistakes

### Calling .queryOptions() without registering the extension

```ts
// ❌ Wrong — no tanstackQuery() in extensions, so the leaf is a plain awaitable with no helpers
NestjsCodegenModule.forRoot({ contracts, codegen, validation: zodAdapter });
useQuery(api.users.list().queryOptions()); // queryOptions is not a function
```

```ts
// ✅ Correct — register the extension so the helpers are emitted onto each leaf
NestjsCodegenModule.forRoot({ contracts, codegen, validation: zodAdapter, extensions: [tanstackQuery()] });
```

Without the extension the client is deliberately TanStack-free; the helpers only exist when
`tanstackQuery()` is in `extensions`.
Source: `apps/docs/content/docs/client/tanstack-query.mdx` ("an extension, not a core flag").

### Leaving `import` on the React default in a Vue/Svelte/Solid app

```ts
// ❌ Wrong — emitted api.ts imports from '@tanstack/react-query' in a Vue app → resolve/type errors
tanstackQuery();
```

```ts
// ✅ Correct — match the adapter you actually installed
tanstackQuery({ import: '@tanstack/vue-query' });
```

The extension bakes the `import` string into the generated `api.ts`; the default is React, so
non-React apps must override it.
Source: `packages/tanstack/src/index.ts` (`import` option), `apps/docs/content/docs/client/tanstack-query.mdx`.

### Expecting .mutationOptions() on a GET route (or .queryOptions() on a write)

```ts
// ❌ Wrong — list is a GET; it has queryOptions, not mutationOptions
useMutation(api.users.list().mutationOptions());
```

```ts
// ✅ Correct — GET routes are queries; POST/PUT/PATCH/DELETE are mutations
useQuery(api.users.list().queryOptions());
useMutation(api.users.create().mutationOptions());
```

The extension assigns helpers by verb: GET leaves carry the query helpers, every other verb carries
`mutationOptions()`.
Source: `apps/docs/content/docs/client/tanstack-query.mdx` ("GET routes get queryOptions(), everything else mutationOptions()").
