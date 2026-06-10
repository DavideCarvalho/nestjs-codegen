---
"@dudousxd/nestjs-codegen": minor
---

Move the Inertia `navigate()` helper + `@inertiajs/react` router import out of core into the
new `@dudousxd/nestjs-inertia-codegen-extension`. The `mutationClient` config option is
removed — register `nestjsInertiaCodegen()` instead to get `navigate()` in `api.ts`. Core's
generated `api.ts` is now Inertia-agnostic (Inertia page discovery / `pages.d.ts` is still
driven by the `pages` config). Same model as `query` → `tanstackQuery()` and
`filterQuery` → `nestjsFilterCodegen()`.
