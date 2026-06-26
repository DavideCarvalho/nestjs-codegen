# @dudousxd/nestjs-codegen-tanstack

## 0.4.2

### Patch Changes

- 81ba774: Ship TanStack Intent agent skills (SKILL.md) inside the package.

## 0.4.1

### Patch Changes

- 367f2dc: Fix: type the generated `infiniteQueryOptions` overrides' `getNextPageParam`/`getPreviousPageParam` as returning `number | null | undefined` (the page param type) instead of `unknown`. `unknown` failed to satisfy TanStack Query's `GetNextPageParamFunction<number, T>` overload, producing TS2769 errors at the call site in strict consumers. Runtime behavior is unchanged — only the emitted type annotation is corrected.

## 0.4.0

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

- 03b3d65: feat(tanstack): configurable pagination/cursor selector for `infiniteQueryOptions()`. The emitted member now takes an optional overrides object (`getNextPageParam` / `getPreviousPageParam` / `initialPageParam`, plus any other TanStack infinite-query option), mirroring Orval/tRPC, so non-`meta.{page,lastPage}` response shapes no longer silently stop at page one. Adds a generation-time `pageParamName` option (default `page`) for cursor-style query-string keys. Fully backward-compatible — a no-arg `infiniteQueryOptions()` call keeps the previous `meta.page`/`meta.lastPage` + `page` behavior.

## 0.3.1

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

- 0fe7439: Unified, awaitable leaf handles (Tuyau-style) + `infiniteQueryOptions`.

  Every generated `api.ts` leaf is now an **awaitable handle**: `await api.users.show({ params })`
  performs the request and resolves to the typed response (memoized, so repeated awaits hit the
  network once), exposing `.fetch()`/`.then`/`.catch`/`.finally` via a small `__req` runtime helper.
  When the TanStack extension is registered, the **same** handle additionally carries
  `.queryKey()`, `.queryOptions()` / `.mutationOptions()`, and now `.infiniteQueryOptions()`
  (GET routes, cursor/page pagination). No more "plain fetch OR handle" split — one call shape
  supports both `await` and the TanStack helpers.

  ```ts
  const user = await api.users.show({ params: { id } }); // request
  useQuery(api.users.show({ params: { id } }).queryOptions()); // tanstack
  useInfiniteQuery(api.users.list().infiniteQueryOptions()); // pagination
  ```

- ad80b18: Filter-search routes are treated as queries. `RequestModel.isQuery` is `true` for GET **or**
  any route carrying `filterFields` (a filtered search is a read even when POST). The TanStack
  layer now emits `.queryOptions()` for `isQuery` routes and `.mutationOptions()` for any non-GET
  — so a filter-search POST gets **both** `.queryOptions()`/`.filterQuery()` and
  `.mutationOptions()`. `.infiniteQueryOptions()` stays GET-only (page goes in the query string).
- fd032c4: TanStack Query is now an extension, not a core flag (extension system Phase 3).

  - New package `@dudousxd/nestjs-codegen-tanstack` exporting `tanstackQuery({ import? })`,
    a `CodegenExtension` whose `apiClientLayer` turns `api.ts` leaves into handles with
    `fetch`/`queryKey`/`queryOptions`|`mutationOptions`. Register it via
    `forRoot({ extensions: [tanstackQuery()] })`.
  - **Breaking (core):** the `query` and `queryImport` config options are removed. Replace
    `query: true` with `extensions: [tanstackQuery()]`, and `queryImport: '@tanstack/vue-query'`
    with `tanstackQuery({ import: '@tanstack/vue-query' })`. The default client is unchanged
    (plain typed fetch). `emitApi` now resolves the api.ts transport/layer/members from the
    registered extensions; output is byte-identical to the old flag (verified by a golden snapshot).

### Patch Changes

- 9c86e57: Move the runtime `filterQuery()` helper out of core into the new
  `@dudousxd/nestjs-filter-codegen` extension. Core no longer emits the `filterQuery`
  member or the `@dudousxd/nestjs-filter-client` value import in `api.ts` — register
  `nestjsFilterCodegen()` to get it. Core still discovers `filterFields`/`filterFieldTypes`
  and renders the type-level `TypedFilterQuery<…>` (query-source filters). Also decouples the
  TanStack layer from filter (it no longer imports `queryOptions` for filter-only routes).
- Updated dependencies [0fe7439]
- Updated dependencies [ad80b18]
- Updated dependencies [9c86e57]
- Updated dependencies [5f52ecf]
- Updated dependencies [3ff3199]
- Updated dependencies [5a9b90e]
- Updated dependencies [fd032c4]
  - @dudousxd/nestjs-codegen@0.2.0
