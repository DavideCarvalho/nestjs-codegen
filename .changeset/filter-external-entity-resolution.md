---
"@dudousxd/nestjs-codegen": minor
---

Fix: resolve `@Filterable({ entity })` entities imported from external npm packages so the route is still classified as a filter route. Previously, when a filter's entity (e.g. a MikroORM entity from `@dudousxd/nestjs-durable-store-mikro-orm`) was imported from `node_modules` rather than an in-repo `*.entity.ts`, the discovery type resolver returned no candidates for the bare module specifier and bailed — degrading the route to a plain bodyless route (`body: never; filterFields: never`, no `queryOptions`) and breaking the generated client (`x.queryOptions is not a function`).

The type resolver now falls back to the TypeScript compiler's own module resolution (`getModuleSpecifierSourceFile()`) for bare node_modules specifiers, locating the package's `.d.ts` declaration file and enumerating the entity's columns from it. External-package filter entities now get the same full `filterFields` union + `body: FilterQueryResult` + TanStack `queryOptions` helper as in-repo entities.
