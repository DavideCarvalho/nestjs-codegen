---
"@dudousxd/nestjs-codegen-tanstack": minor
---

feat(tanstack): configurable pagination/cursor selector for `infiniteQueryOptions()`. The emitted member now takes an optional overrides object (`getNextPageParam` / `getPreviousPageParam` / `initialPageParam`, plus any other TanStack infinite-query option), mirroring Orval/tRPC, so non-`meta.{page,lastPage}` response shapes no longer silently stop at page one. Adds a generation-time `pageParamName` option (default `page`) for cursor-style query-string keys. Fully backward-compatible — a no-arg `infiniteQueryOptions()` call keeps the previous `meta.page`/`meta.lastPage` + `page` behavior.
