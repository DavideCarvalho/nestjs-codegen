---
"@dudousxd/nestjs-codegen-tanstack": minor
---

`queryOptions()`, `infiniteQueryOptions()` and `handleQuery()` pass TanStack's `AbortSignal` to the request, so a query TanStack cancels (unmount, key change, `cancelQueries`) aborts its HTTP request. Needs the matching `@dudousxd/nestjs-codegen` and `@dudousxd/nestjs-client` releases.
