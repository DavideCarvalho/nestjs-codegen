# @dudousxd/nestjs-client

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
