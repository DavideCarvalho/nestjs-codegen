# @dudousxd/nestjs-codegen

## 0.13.1

### Patch Changes

- 6b51c7b: fix(multipart): intersect the uploaded-file field at emit time so it survives a named `bodyRef`, and leave deliberately-loose bodies untouched.

  Two fixes to the multipart upload routes shipped in 0.13.0:

  - **Named body refs now include the file field.** Discovery carries the uploaded-file
    field(s) in a new `multipartBody` (kept off `body`), and the emitter intersects it onto
    whichever body expression it picks — a named `bodyRef` (`BaseFileUploadDto`) or the inline
    text. Previously the merge lived on the inline `body` string, so a route whose `@Body`
    resolved to an imported DTO emitted the plain `BaseFileUploadDto` and dropped the file
    field (`api.X({ body: { ...fields, file } })` failed to type-check).

  - **Deliberately-loose bodies are left alone.** A `@Body() x: SomeDto | any` handler resolves
    to a top-level `unknown`/`any` union arm; intersecting `(Dto | unknown) & { file }` collapses
    it and wrongly tightens the type. The emitter now detects a permissive body and skips the
    intersection, keeping the author's loose `@Body()` (the route is still flagged `multipart`).

## 0.13.0

### Minor Changes

- a044e73: feat: typed `multipart/form-data` upload routes (`@UploadedFile()` / Multer interceptors).

  The codegen now understands handlers that accept uploaded files, so multipart uploads
  become first-class typed routes (`api.X({ body: { ...fields, file } })`) instead of
  needing the `fetchRaw` escape hatch.

  **core (`@dudousxd/nestjs-codegen`):**

  - Discovery detects `@UploadedFile()` / `@UploadedFiles()` handlers and reads the HTTP
    field name(s) + arity from the Multer interceptor in `@UseInterceptors(...)`:
    - `FileInterceptor('file')` → `file: File | Blob`
    - `FilesInterceptor('files')` → `files: Array<File | Blob>`
    - `FileFieldsInterceptor([{ name: 'a' }, { name: 'b' }])` → `a: Array<File | Blob>; b: Array<File | Blob>`
    - `AnyFilesInterceptor()` → flagged multipart (no statically known field names)
  - The uploaded-file field(s) are merged into the route `body` as an intersection with the
    `@Body` DTO (`SomeDto & { file: File | Blob }`), typed for the browser as `File | Blob`
    (never the server-side `Express.Multer.File`).
  - The route carries a new `multipart` flag, emitted into the generated client so the call
    passes `multipart: true` to the fetcher.

  **client (`@dudousxd/nestjs-client`):**

  - `RequestOpts` gains `multipart?: boolean`. When set, the fetcher serializes the body
    object to a `FormData` (scalars as strings, `Date` as ISO, `File`/`Blob` as file parts,
    arrays as repeated parts) instead of JSON, letting the runtime set the multipart
    boundary. `onUploadProgress` already rides the same path.

## 0.12.0

### Minor Changes

- 5a2619c: perf(core): make the boot-time watcher production-safe, non-blocking, and idempotent.

  Three changes to the `NestjsCodegenModule` `onApplicationBootstrap` path so dev-watch
  restarts no longer pay the full codegen cost on time-to-ready:

  - **Skip in production.** `NODE_ENV` is now normalized (trimmed + lowercased) before the
    production check, and the watcher is skipped with a single concise log line when it is
    `production`. A new `runInProduction?: boolean` option (default `false`) forces it on if
    ever needed; explicit `enabled` still overrides both.

  - **Non-blocking boot.** The initial discover + generate triggered by
    `onApplicationBootstrap` now runs fire-and-forget (`watch(config, undefined, { deferInitialGenerate: true })`)
    so it no longer blocks `NestFactory.create`. The lock and the chokidar watchers are
    still set up synchronously, lock NO_OP semantics are preserved, and a rejected initial
    generate is caught and logged rather than crashing the process. The one-shot CLI
    (`nestjs-codegen codegen`) stays fully synchronous.

  - **Skip-when-unchanged.** `generate()` now records a content hash (over all discovered
    controller/DTO/page source files + the serialized resolved config + the lib version) and
    the emitted output file list in `<outDir>/.codegen-manifest.json`. When the hash matches
    and every recorded output still exists, the pass is skipped — stopping HMR from rewriting
    `api.ts` (and churning downstream `tsbuildinfo`) when nothing changed. Any input change,
    a missing output, or a lib upgrade invalidates the manifest and regenerates.

## 0.11.0

### Minor Changes

- b9efd1c: fix(core): emit a clean prefix `queryKey` when a query handle is called with no input.

  Previously the generated `queryKey()` was always `[name, input]`, so calling it with
  no argument produced `[name, undefined]` — a two-element key whose trailing `undefined`
  does NOT partial-match the parametrized live queries (`[name, { params, query }]`).
  That made the bare `api.x.y().queryKey()` useless for `invalidateQueries`: it silently
  matched nothing.

  The key now omits the trailing element when `input === undefined`
  (`input === undefined ? [name] : [name, input]`), so `api.x.y().queryKey()` is a proper
  prefix that partial-matches every parametrized variant. Invalidating a whole route is now
  just `queryClient.invalidateQueries({ queryKey: api.x.y().queryKey() })` — no manual
  key construction or slicing. Passing the real input still yields `[name, input]` for an
  exact match. Keys carrying input are unchanged.

## 0.10.0

### Minor Changes

- 152a2ab: Narrow the public `ValidationOption` type to `ValidationAdapter` only. The string
  shortcuts (`'zod'` / `'valibot'` / `'arktype'`) were advertised by the type but
  `resolveAdapter` always threw a `ConfigError` for any string, so they never worked
  at runtime. The type now guides TypeScript users to import and pass an adapter
  instance (e.g. `zodAdapter` from `@dudousxd/nestjs-codegen-zod`).

  The runtime guard is retained: `resolveAdapter` still accepts a `string` and throws
  the helpful "install + import the adapter package" error, so JS callers and untyped
  configs that pass a removed string shortcut get the same actionable message.

  This is a compile-time-only breaking change for anyone still typing `validation:
'zod'` — it never produced working output at runtime, so the bump is minor.

### Patch Changes

- 81ba774: Ship TanStack Intent agent skills (SKILL.md) inside the package.

## 0.9.0

### Minor Changes

- ff9e27b: feat(core): gate schema-translation advisories behind a new `debug` config flag (default off).

  On every codegen pass the discovery layer logged a `[nestjs-codegen]` line to the
  terminal for each schema-translation advisory — `@X is not translatable to a client
validation schema and was skipped`, `T is a recursive type; ... lazy self-reference`,
  over-deep nesting, and unresolvable `@IsEnum`. On a real project these fire dozens of
  times per run and are pure noise.

  These advisories are already preserved where they matter: in the returned
  `SchemaModule.warnings` array and as `// warning:` comments in the generated output.
  The terminal copy is now opt-in: add `debug: true` to `nestjs-codegen.config.ts`
  (or `NestjsCodegenModule.forRoot({ debug: true })`) to print them again. Default is
  `false`, so a normal run is quiet. No effect on generated artifacts.

## 0.8.0

### Minor Changes

- 685583d: feat(core): synthesize the route `query` type from individual `@Query('name')` params. Handlers using named query params (e.g. `@Query('years') years?: number[]`, `@Query('q') q?: string | string[]`) now emit a typed `query` object — one property per param, keyed by the string-literal name, typed by the parameter annotation, optional when the param has `?` / a default / a `| undefined` type — instead of `query: never`. The existing whole-object `@Query() dto` form is unchanged and still wins when both forms appear on the same handler.

## 0.7.1

### Patch Changes

- b8a8ce4: fix(core): load the TypeScript config via Node's native type-stripping first, falling back to tsx — unblocks the codegen CLI on Node 25 where tsx 4.22.4's resolver appends a `?namespace=<ts>` query that Node 25's stricter `finalizeResolution` rejects with `ERR_MODULE_NOT_FOUND`. tsx remains the fallback for older Node versions without native type stripping.

## 0.7.0

### Minor Changes

- ff8ad8b: Jsonify-by-default serialized response types, with an opt-out `serialization` config option.

  The generated `api.ts` now reflects the **JSON wire shape** of each route's response rather than the in-process server return type. A controller returning `{ createdAt: Date }` now generates `response: Jsonify<{ createdAt: string }>` — because `Date.prototype.toJSON()` emits an ISO string. `Jsonify<T>` recurses arrays/objects, follows any `toJSON()` holder to its returned shape, drops non-serializable properties (functions/symbols), keeps optional properties optional, and passes `any`/`unknown` through untouched. It is a hand-rolled, type-only utility with no runtime footprint.

  - **`@dudousxd/nestjs-client`** exports the new `Jsonify<T>` type.
  - **`@dudousxd/nestjs-codegen`** wraps each route `response` field in `Jsonify<...>` by default and emits `import type { Jsonify } from '<runtime>'` (tracking `fetcher.importPath`) when at least one route is wrapped. Only the `response` field is wrapped — never `error`, `body`, or `query`.
  - New config option `serialization?: 'json' | 'superjson'` (default `'json'`). In `'superjson'` mode the raw controller return type is emitted unchanged (Dates/Maps/Sets are revived on the client), and no `Jsonify` import is emitted.

## 0.6.1

### Patch Changes

- 95c744f: Fix watcher clobbering `api.ts` with an extension-only stub on page edits. The
  pages fast path called `generate(config)` with no routes, so a route-injecting
  extension (e.g. the notifications codegen) still emitted — overwriting the full
  `api.ts` with just the injected namespace and dropping every contract-derived
  route. The watcher now caches the last discovered routes (from the initial pass
  and each contracts rediscovery) and reuses them for pages-only regenerations.

## 0.6.0

### Minor Changes

- ece130c: Fix: resolve `@Filterable({ entity })` entities imported from external npm packages so the route is still classified as a filter route. Previously, when a filter's entity (e.g. a MikroORM entity from `@dudousxd/nestjs-durable-store-mikro-orm`) was imported from `node_modules` rather than an in-repo `*.entity.ts`, the discovery type resolver returned no candidates for the bare module specifier and bailed — degrading the route to a plain bodyless route (`body: never; filterFields: never`, no `queryOptions`) and breaking the generated client (`x.queryOptions is not a function`).

  The type resolver now falls back to the TypeScript compiler's own module resolution (`getModuleSpecifierSourceFile()`) for bare node_modules specifiers, locating the package's `.d.ts` declaration file and enumerating the entity's columns from it. External-package filter entities now get the same full `filterFields` union + `body: FilterQueryResult` + TanStack `queryOptions` helper as in-repo entities.

## 0.5.2

### Patch Changes

- f432450: Internal refactors (behavior-preserving): share `renderModule` across the zod/valibot adapters via a `createChainModuleRenderer` factory, and dedupe the nested-reference array-wrap + presence tail in `buildProperty` (`dto-to-ir`) behind a single `asField` closure.

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
