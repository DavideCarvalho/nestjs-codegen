---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-tanstack": minor
---

Filter-search routes are treated as queries. `RequestModel.isQuery` is `true` for GET **or**
any route carrying `filterFields` (a filtered search is a read even when POST). The TanStack
layer now emits `.queryOptions()` for `isQuery` routes and `.mutationOptions()` for any non-GET
— so a filter-search POST gets **both** `.queryOptions()`/`.filterQuery()` and
`.mutationOptions()`. `.infiniteQueryOptions()` stays GET-only (page goes in the query string).
