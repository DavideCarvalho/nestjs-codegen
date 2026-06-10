---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-tanstack": minor
---

TanStack Query is now an extension, not a core flag (extension system Phase 3).

- New package `@dudousxd/nestjs-codegen-tanstack` exporting `tanstackQuery({ import? })`,
  a `CodegenExtension` whose `apiClientLayer` turns `api.ts` leaves into handles with
  `fetch`/`queryKey`/`queryOptions`|`mutationOptions`. Register it via
  `forRoot({ extensions: [tanstackQuery()] })`.
- **Breaking (core):** the `query` and `queryImport` config options are removed. Replace
  `query: true` with `extensions: [tanstackQuery()]`, and `queryImport: '@tanstack/vue-query'`
  with `tanstackQuery({ import: '@tanstack/vue-query' })`. The default client is unchanged
  (plain typed fetch). `emitApi` now resolves the api.ts transport/layer/members from the
  registered extensions; output is byte-identical to the old flag (verified by a golden snapshot).
