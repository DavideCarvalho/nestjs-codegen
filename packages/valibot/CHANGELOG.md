# @dudousxd/nestjs-codegen-valibot

## 0.5.0

### Minor Changes

- 03b3d65: feat: ecosystem improvements across the codegen toolchain.

  - **Typed per-route errors (`Route.Error<K>` now real).** Each emitted leaf route carries a real `error` type, discovered statically from a `defineContract({ error })` schema or a 4xx/5xx `@ApiResponse({ status, type })` decorator. `ApiHttpError` is generic so `err.body` can be narrowed to a route's `Route.Error<K>`.
  - **Discriminated-union DTO support (zod / valibot / arktype).** class-transformer's `@Type(() => Base, { discriminator })` is detected and emitted as a proper tagged union (`z.discriminatedUnion`, `v.variant`, arktype alternation), with each subtype hoisted as a named schema.
  - **Generic wrapper type fidelity (e.g. `PaginatedDto<T>`).** Generic wrapper DTOs substitute their type parameters when resolving both the validation IR and the inline TS type strings, so `PaginatedDto<Item>` resolves to its real shape instead of degrading to `unknown`.
  - **SSE / streaming response typing.** Server-sent-event and streaming endpoints are recognized and emitted with accurate response types.
  - **Cross-file `@ApplyContract` identifier resolution.** Contract identifiers referenced from other files are resolved across the project, including unresolvable-reference handling.
  - **Configurable infinite-query pagination / cursor selector.** TanStack infinite-query generation supports a configurable pagination and cursor selector.
  - **OpenAPI 3.1 export.** The IR can be exported to an OpenAPI 3.1 document.
  - **MSW + mock generation.** Generates MSW handlers and mock data from the discovered IR.
  - **Dual ESM/CJS packaging + exports/types fixes.** Packages ship dual ESM/CJS builds with corrected `exports` and `types` resolution.

- 03b3d65: feat(codegen): type-fidelity improvements.

  - **Typed errors per route (`Route.Error<K>` / `Path.Error<M, U>`).** The emitted leaf type block now carries an `error` field, so the previously-dead `Route.Error<K>` resolves to a real type. The error type is discovered statically from either a `defineContract({ error })` zod schema or an `@ApiResponse({ status, type })` decorator whose `status` is a 4xx/5xx code (the least-magic signal — it reuses the Swagger decorator NestJS apps already write). Routes without a declared error type resolve to `unknown` (an HTTP error always carries some body). `ApiHttpError` is now generic (`ApiHttpError<TBody = unknown>`) so `err.body` can be narrowed to a route's `Route.Error<K>`.
  - **Discriminated-union DTOs.** class-transformer's `@Type(() => Base, { discriminator: { property, subTypes } })` is now detected and emitted as a proper tagged union: zod `z.discriminatedUnion`, valibot `v.variant`, arktype tuple alternation (`[a, "|", b]`). Each subtype is hoisted as a named schema.
  - **Generic wrapper fidelity (`PaginatedDto<T>`).** Generic wrapper DTOs now substitute their type parameters when resolving both the neutral validation IR (so a field typed `T`/`T[]` resolves faithfully instead of degrading to `unknown`) and the inline TS type strings used for body/query/response. `PaginatedDto<Item>` now resolves to its real shape rather than `{ data: Array<unknown> }`.

  Backward-compatible: the only golden change is the new `error` field on each emitted leaf type.

## 0.4.0

### Minor Changes

- ed04cdc: Validate recursive DTOs instead of degrading them to `unknown`.

  Self/mutually-recursive `@ValidateNested` DTOs (e.g. a `ColumnFilter` whose `and`/`or`
  reference `ColumnFilter[]`) used to be degraded to `unknown` with a warning, dropping all
  client-side validation for that field. They are now expanded with a real lazy schema:

  - **zod / valibot** hoist a structural TS `type` alias and annotate the recursive const
    (`z.ZodType<T>` / `v.GenericSchema<T>`) so the implicit-any self-reference cycle is broken;
    the recursion site uses `z.lazy` / `v.lazy`.
  - **arktype** uses the native `this` keyword for self-recursion. Mutual recursion (A ↔ B)
    cannot be expressed per-schema without a scope, so the back-edge schema still degrades to
    `unknown` with a clear warning — use the zod or valibot adapter for full validation there.

  The over-deep nesting guard is now reported separately ("nesting too deep") instead of being
  mislabelled as recursion. The raw-zod `defineContract` path is unchanged.

### Patch Changes

- d14fa68: Widen the `@dudousxd/nestjs-codegen` peer dependency range to `>=0.3.0 <1` so a core
  minor bump (e.g. 0.3.0 → 0.4.0) no longer falls out of the adapters' caret range and
  triggers a spurious **major** bump for every adapter. The codegen family versions in 0.x
  lockstep; the peer range now tolerates the whole 0.x line.

## 0.3.0

### Patch Changes

- Updated dependencies [b0fcd58]
  - @dudousxd/nestjs-codegen@0.3.0

## 0.2.1

### Patch Changes

- 0207fcc: docs: add a README to every published package and update the docs site to the extension architecture

  Each package now ships a README (npm package pages were previously blank), and the
  docs site documents integrations as registered `extensions: [...]` (the obsolete
  `mutationClient` option is gone) with a new "Extensions" page covering the
  `@dudousxd/nestjs-codegen/extension` contract.

## 0.2.0

### Minor Changes

- 3ff3199: Initial release: typed-client codegen for NestJS.

  - `@dudousxd/nestjs-codegen` — discovery (controllers, `defineContract`, DTOs, pages,
    shared props, filters), emitters (`routes.ts`/`api.ts`/`forms.ts`/`pages.d.ts`),
    config loader, watch mode, and the `codegen`/`init`/`doctor` CLI. Bundles the neutral
    validation IR + zod adapter.
  - `@dudousxd/nestjs-codegen-valibot`, `@dudousxd/nestjs-codegen-arktype` — validation
    adapters rendering the shared IR.
  - `@dudousxd/nestjs-client` — framework-neutral runtime: typed fetcher with a pluggable
    transport (axios via `axiosTransport`) and a superjson transformer hook.

  Highlights: pluggable validation, Tuyau-style `createApi(fetcher)` factory, optional
  TanStack Query (configurable adapter import), and nestjs-inertia + nestjs-filter
  integrations.

### Patch Changes

- Updated dependencies [0fe7439]
- Updated dependencies [ad80b18]
- Updated dependencies [9c86e57]
- Updated dependencies [5f52ecf]
- Updated dependencies [3ff3199]
- Updated dependencies [5a9b90e]
- Updated dependencies [fd032c4]
  - @dudousxd/nestjs-codegen@0.2.0
