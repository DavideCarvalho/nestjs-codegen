# @dudousxd/nestjs-client

## 0.3.0

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

- d49abf9: Allow explicit `undefined` on `RequestOpts`/`BuildUrlOptions` `params`/`query`. The
  generated client passes `{ query: input?.query }` (possibly `undefined`); the fetcher
  types now accept that under `exactOptionalPropertyTypes: true`, so the generated `api.ts`
  type-checks in strict consumers.
