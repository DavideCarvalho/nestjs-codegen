---
"@dudousxd/nestjs-codegen": minor
---

feat(core): synthesize the route `query` type from individual `@Query('name')` params. Handlers using named query params (e.g. `@Query('years') years?: number[]`, `@Query('q') q?: string | string[]`) now emit a typed `query` object — one property per param, keyed by the string-literal name, typed by the parameter annotation, optional when the param has `?` / a default / a `| undefined` type — instead of `query: never`. The existing whole-object `@Query() dto` form is unchanged and still wins when both forms appear on the same handler.
