---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-tanstack": minor
---

feat: binary (blob) response mode, `@AsQuery()` marker, CLI↔module config-drift guard, and a `handleQuery` TanStack helper.

- **Binary (blob) response mode.** A handler returning NestJS `StreamableFile` or Node `Buffer`
  (including `Promise<StreamableFile>`) is now discovered as `binaryResponse: true` and emitted
  with `response: RawResponse<Blob>` (never `Jsonify<...>`) — the leaf issues its request via
  `fetcher.fetchBlob(...)` instead of the verb method, so callers get `{ data, status, headers }`
  and can read `content-disposition` etc. Works on any HTTP method (`fetchBlob` already accepted
  a `method` opt); a non-GET binary route passes it explicitly since `fetchBlob` defaults to GET.
  `Observable`/`ReadableStream` handlers are unaffected — they stay on the existing SSE/stream
  path. Each `ApiRouter` leaf now also carries a `binary` flag (`Route.Binary<K>` /
  `Path.Binary<M, U>` type helpers), mirroring `stream`.
- **`@AsQuery()` marker** (new `@dudousxd/nestjs-codegen/markers` subpath — zero-import, runtime
  no-op). Marks a non-GET route whose semantics are a read (e.g. a POST with a query-shaped
  payload) so codegen emits `queryOptions` for it, exactly like a GET or a filter-search route.
- **CLI↔module config-drift guard.** The CLI (`nestjs-codegen.config.ts`) and the Nest module
  (`NestjsCodegenModule.forRoot()`) can target the same `outDir` from independently-resolved
  configs; if they genuinely differ (e.g. `serialization` `'json'` vs `'superjson'`), each run
  used to silently overwrite the other's `api.ts` shape. `generate()` now throws a
  `DriftGuardError` *before writing anything* when the manifest's `entryPoint` differs from the
  current run's AND the resolved configs' hashes differ — naming both entry points and
  instructing how to fix it (share one config object, or set `driftGuard: false`). Same entry
  point (a normal config edit) or same config across entry points both proceed as before.
- **TanStack: `handleQuery` helper**, emitted into `api.ts` whenever the TanStack layer is
  active. Wraps any `{ queryKey, fetch }`-shaped handle (a POST-as-query handle, or a runtime
  pick between two different handles) into a plain `{ queryKey, queryFn }` pair — solves the
  useQuery-overload break from spreading a ternary of `queryOptions()` calls. Also: binary GET
  routes get `queryOptions` but never `infiniteQueryOptions` (a download isn't paginated data).
