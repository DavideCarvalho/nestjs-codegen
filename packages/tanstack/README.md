# @dudousxd/nestjs-codegen-tanstack

> A TanStack Query layer for [`@dudousxd/nestjs-codegen`](https://github.com/DavideCarvalho/nestjs-codegen) — turns every generated endpoint into a handle that carries `queryOptions` / `mutationOptions`.

![npm](https://img.shields.io/npm/v/@dudousxd/nestjs-codegen-tanstack)

`@dudousxd/nestjs-codegen` generates a [plain typed fetch client](https://github.com/DavideCarvalho/nestjs-codegen) — `await api.users.show({ params })` does a real request and there's no TanStack dependency. This package is a **CodegenExtension** that layers TanStack Query on top: each leaf of the generated `api.ts` becomes a **unified handle** that is still awaitable, but *also* exposes `queryKey()`, `queryOptions()`, `infiniteQueryOptions()`, and `mutationOptions()` built from the route's name, input, and the injected fetcher.

The duality is the point — the *same* handle does both:

```ts
await api.users.show({ params });                 // fetches
api.users.show({ params }).queryOptions();        // returns the TanStack options object
```

## Install

It's a codegen-time extension, so it belongs in `devDependencies`:

```bash
pnpm add -D @dudousxd/nestjs-codegen-tanstack
```

The runtime peer is your framework's TanStack adapter — the one you already have. You **don't** install `@tanstack/query-core` directly; the adapter re-exports the helpers the generated code imports. `@tanstack/react-query` is the default.

## Setup

Register it in the `extensions` array of `NestjsCodegenModule.forRoot`:

```ts
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';

NestjsCodegenModule.forRoot({
  // …
  extensions: [tanstackQuery()],
});
```

By default the helpers are imported from `@tanstack/react-query`. Point the `import` option at your framework's adapter so Vue/Svelte/Solid users get the right module — it never forces `@tanstack/query-core`:

```ts
tanstackQuery();                                  // import: '@tanstack/react-query' (default)
tanstackQuery({ import: '@tanstack/vue-query' });
tanstackQuery({ import: '@tanstack/svelte-query' });
tanstackQuery({ import: '@tanstack/solid-query' });
```

## What it generates

Per route, the extension adds these members to the leaf handle:

| Helper                    | Emitted on                                          |
| ------------------------- | --------------------------------------------------- |
| `queryKey()`              | **every** leaf — a stable key from route name + input |
| `queryOptions()`          | reads — GET routes and nestjs-filter search routes  |
| `infiniteQueryOptions()`  | GET routes only (page-based pagination)             |
| `mutationOptions()`       | every non-GET route (POST/PUT/PATCH/DELETE)         |

Filter-search routes that are POSTs count as both a read and a write, so they get **both** `queryOptions()` and `mutationOptions()`.

The handle stays awaitable, and each helper returns a *real* options object you compose with your own `select`, `staleTime`, `onSuccess`, etc.:

```tsx
import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '../lib/api';

function Users() {
  const qc = useQueryClient();

  const list = useQuery(api.users.list().queryOptions());
  const pages = useInfiniteQuery(api.users.list().infiniteQueryOptions());

  const create = useMutation({
    ...api.users.create().mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: api.users.list().queryKey() }),
  });
  // …
}
```

The mutation's `mutationFn` takes the **full leaf input** (`{ params?, query?, body? }`), so path params can be supplied dynamically at `mutate()` time rather than only when you build the handle.

`infiniteQueryOptions()` appends `page` to the query string and derives the next page from `response.meta.page` / `response.meta.lastPage`.

## How it fits

`tanstackQuery()` is one of several **CodegenExtensions** for `@dudousxd/nestjs-codegen`. They all compose in the same `extensions: [...]` array alongside the core generator, the client layer, and (optionally) the filter or Inertia extensions:

```ts
NestjsCodegenModule.forRoot({
  extensions: [
    tanstackQuery(),
    // …other extensions
  ],
});
```

It only adds TanStack helpers — the underlying typed fetch client is unchanged, so endpoints you never wrap in `useQuery`/`useMutation` keep working as plain awaitable calls.

## Documentation

- TanStack Query guide: https://github.com/DavideCarvalho/nestjs-codegen (see `docs/tanstack-query`)
- Repository: https://github.com/DavideCarvalho/nestjs-codegen

## License

MIT
