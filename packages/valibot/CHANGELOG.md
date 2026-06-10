# @dudousxd/nestjs-codegen-valibot

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
