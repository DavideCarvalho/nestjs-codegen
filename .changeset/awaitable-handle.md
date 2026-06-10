---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-tanstack": minor
---

Unified, awaitable leaf handles (Tuyau-style) + `infiniteQueryOptions`.

Every generated `api.ts` leaf is now an **awaitable handle**: `await api.users.show({ params })`
performs the request and resolves to the typed response (memoized, so repeated awaits hit the
network once), exposing `.fetch()`/`.then`/`.catch`/`.finally` via a small `__req` runtime helper.
When the TanStack extension is registered, the **same** handle additionally carries
`.queryKey()`, `.queryOptions()` / `.mutationOptions()`, and now `.infiniteQueryOptions()`
(GET routes, cursor/page pagination). No more "plain fetch OR handle" split — one call shape
supports both `await` and the TanStack helpers.

```ts
const user = await api.users.show({ params: { id } });          // request
useQuery(api.users.show({ params: { id } }).queryOptions());     // tanstack
useInfiniteQuery(api.users.list().infiniteQueryOptions());       // pagination
```
