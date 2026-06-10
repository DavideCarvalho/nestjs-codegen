---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-tanstack": patch
---

Move the runtime `filterQuery()` helper out of core into the new
`@dudousxd/nestjs-filter-codegen` extension. Core no longer emits the `filterQuery`
member or the `@dudousxd/nestjs-filter-client` value import in `api.ts` — register
`nestjsFilterCodegen()` to get it. Core still discovers `filterFields`/`filterFieldTypes`
and renders the type-level `TypedFilterQuery<…>` (query-source filters). Also decouples the
TanStack layer from filter (it no longer imports `queryOptions` for filter-only routes).
