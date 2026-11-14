---
"@dudousxd/nestjs-codegen-tanstack": minor
---

The default `infiniteQueryOptions()` next-page selector reads `meta.currentPage` (the Aviary list envelope `{ data, meta: { total, perPage, currentPage, lastPage, firstPage } }`) and still falls back to `meta.page`, so generated infinite queries page through every Aviary offset list without a custom `getNextPageParam`.
