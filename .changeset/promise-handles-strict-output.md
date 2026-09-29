---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-tanstack": patch
---

Request handles are real Promises, and `api.ts` compiles under strict compiler flags.

- A generated leaf call (`api.users.create({ body })`) now returns a `RequestHandle<R>`: a
  lazy, memoized `Promise<R>` that also carries `fetch()` and the extension members
  (`queryKey`, `queryOptions`, `mutationOptions`, …). It can be returned from a TanStack
  `mutationFn`/`queryFn`, passed to `Promise.all` or assigned to `Promise<T>` without calling
  `.fetch()` first. Nothing is sent until it is awaited, so building `queryOptions()` or
  reading `queryKey()` never fires a request. `.fetch()` keeps working.
- `api.ts` imports from `routes.ts` only the names it uses (no unused `ROUTES`/`RouteName`/…),
  a leaf with no input to read takes no parameter, and `infiniteQueryOptions()` no longer
  passes `getPreviousPageParam: undefined`. The output is clean under `noUnusedLocals`,
  `noUnusedParameters`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature`; a fixture test compiles
  it with all of them.
