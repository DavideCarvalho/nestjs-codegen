# @dudousxd/nestjs-codegen

## 0.5.1

### Patch Changes

- 7dee3f6: perf: faster generation — `aliasFor` uses a maintained in-use-name set (O(n²)→O(1) over nested DTOs) and `planNestedSchemas` caches compiled rename regexes + uses a maintained Set for membership instead of rebuilding arrays. Generated output is byte-identical.

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

- 03b3d65: feat(codegen): SSE/streaming response typing + cross-file `@ApplyContract` refs.

  - **SSE / streaming response typing.** NestJS streaming endpoints are now discovered and typed. The least-magic, fully-static signal: a `@Sse()` decorator, OR a handler whose return type is `Observable<T>` / `AsyncIterable<T>` / `AsyncGenerator<T>`. `@Sse('path')` is treated as a `GET` route. The streamed element type `T` is carried through the IR/`RouteDescriptor` (`contractSource.stream` + the element as `response`/`responseRef`), unwrapping any `Promise<>` and the NestJS `MessageEvent<T>` envelope to the real payload. The emitted leaf gains a typed `stream()` member returning `AsyncIterable<T>`, the ApiRouter type block carries `stream: true|false`, and a new `Route.Stream<K>` / `Path.Stream<M, U>` type helper resolves the streamed element. A runtime SSE consumer is added to the client (`fetcher.sse<T>(path, opts)` + the exported `consumeSse` helper) that parses the `text/event-stream` wire format into a typed async iterable.
  - **Cross-file `@ApplyContract` identifier refs.** `@ApplyContract(importedConst)` where the contract is an imported identifier is now resolved across files: ts-morph follows the import (and barrel `export { X } from './mod'` / `export *` re-exports) to the declaring `defineContract` const, so a contract declared in another file is discovered and emitted. The Path A schema re-export ref now points at the const's declaring file. An identifier that genuinely cannot be resolved still warns and is skipped (prior behavior preserved).

  Backward-compatible. Golden snapshots gain the new `stream` leaf field and `Stream` namespace members. Note: a bare `Observable<T>` return type (previously mapped to `unknown` as server-only) is now a stream of `T`.

- 03b3d65: feat(codegen): type-fidelity improvements.

  - **Typed errors per route (`Route.Error<K>` / `Path.Error<M, U>`).** The emitted leaf type block now carries an `error` field, so the previously-dead `Route.Error<K>` resolves to a real type. The error type is discovered statically from either a `defineContract({ error })` zod schema or an `@ApiResponse({ status, type })` decorator whose `status` is a 4xx/5xx code (the least-magic signal — it reuses the Swagger decorator NestJS apps already write). Routes without a declared error type resolve to `unknown` (an HTTP error always carries some body). `ApiHttpError` is now generic (`ApiHttpError<TBody = unknown>`) so `err.body` can be narrowed to a route's `Route.Error<K>`.
  - **Discriminated-union DTOs.** class-transformer's `@Type(() => Base, { discriminator: { property, subTypes } })` is now detected and emitted as a proper tagged union: zod `z.discriminatedUnion`, valibot `v.variant`, arktype tuple alternation (`[a, "|", b]`). Each subtype is hoisted as a named schema.
  - **Generic wrapper fidelity (`PaginatedDto<T>`).** Generic wrapper DTOs now substitute their type parameters when resolving both the neutral validation IR (so a field typed `T`/`T[]` resolves faithfully instead of degrading to `unknown`) and the inline TS type strings used for body/query/response. `PaginatedDto<Item>` now resolves to its real shape rather than `{ data: Array<unknown> }`.

  Backward-compatible: the only golden change is the new `error` field on each emitted leaf type.

## 0.4.1

### Patch Changes

- 6a6be24: perf: memoize type and enum resolution during generation — per-`Project` `WeakMap` caches for `findType`, `resolveTypeRef`'s named-symbol arm, and `resolveEnumValues`, so a type referenced N times is resolved once. Keyed by `Project` so each (watch) run gets a fresh cache; generated output is byte-identical.

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

- ed04cdc: Fix array detection for union types. A property typed `unknown | unknown[]` (or any
  union whose text happens to end in `[]`) was mistakenly treated as an array and wrapped
  in `z.array(...)`. Array detection now uses the AST (`ArrayTypeNode`) instead of a
  `.endsWith('[]')` text check, so only genuine `T[]` properties become arrays.

## 0.3.0

### Minor Changes

- b0fcd58: BREAKING (0.x minor bump): `validation` is now a required config field, and the zod
  adapter is no longer bundled in core.

  - `zodAdapter` is no longer exported from `@dudousxd/nestjs-codegen`. Import it from
    `@dudousxd/nestjs-codegen-zod` instead.
  - The `validation: 'zod'` string shortcut no longer resolves — like `'valibot'` and
    `'arktype'`, the string forms now throw, directing you to install the adapter
    package and pass the instance.
  - `validation` must be provided. Both `loadConfig` (config file) and `resolveConfig`
    (`NestjsCodegenModule.forRoot`) throw a clear `ConfigError` when it is missing.

  Migration:

  ```ts
  import { zodAdapter } from "@dudousxd/nestjs-codegen-zod";

  export default defineConfig({
    validation: zodAdapter,
    // ...
  });
  ```

  Adapters now advertise raw-zod passthrough via the new optional
  `ValidationAdapter.acceptsRawZodSource` capability (set only by `zodAdapter`),
  decoupling `emit-forms` from a hardcoded `'zod'` name check.

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
- 9c86e57: Move the runtime `filterQuery()` helper out of core into the new
  `@dudousxd/nestjs-filter-codegen` extension. Core no longer emits the `filterQuery`
  member or the `@dudousxd/nestjs-filter-client` value import in `api.ts` — register
  `nestjsFilterCodegen()` to get it. Core still discovers `filterFields`/`filterFieldTypes`
  and renders the type-level `TypedFilterQuery<…>` (query-source filters). Also decouples the
  TanStack layer from filter (it no longer imports `queryOptions` for filter-only routes).
- 5f52ecf: Move the Inertia `navigate()` helper + `@inertiajs/react` router import out of core into the
  new `@dudousxd/nestjs-inertia-codegen-extension`. The `mutationClient` config option is
  removed — register `nestjsInertiaCodegen()` instead to get `navigate()` in `api.ts`. Core's
  generated `api.ts` is now Inertia-agnostic (Inertia page discovery / `pages.d.ts` is still
  driven by the `pages` config). Same model as `query` → `tanstackQuery()` and
  `filterQuery` → `nestjsFilterCodegen()`.
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

- 5a9b90e: Add `NestjsCodegenModule.forRoot()` — a NestJS module (exported from
  `@dudousxd/nestjs-codegen/nest`) that auto-starts the codegen watcher on app boot, the
  recommended way to wire the codegen in dev. Import it into your `AppModule` and the typed
  client regenerates as you edit controllers — no config file, no separate process. Skips the
  watcher in production by default (`enabled`/`cwd` options to override); `@nestjs/common` is an
  optional peer dependency. The one-shot CLI remains for CI/pre-deploy runs.

  Also exposes `resolveConfig(userConfig, cwd?)` for resolving config in memory, and fixes the
  watcher's incremental contracts pass to honor the full emit options (`query` /
  `mutationClient` / `queryImport` / validation adapter) instead of silently dropping them on
  each edit.

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
