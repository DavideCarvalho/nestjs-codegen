# @dudousxd/nestjs-codegen

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
