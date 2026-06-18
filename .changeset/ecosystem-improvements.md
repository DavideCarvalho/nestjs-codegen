---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-zod": minor
"@dudousxd/nestjs-codegen-valibot": minor
"@dudousxd/nestjs-codegen-arktype": minor
"@dudousxd/nestjs-codegen-tanstack": minor
"@dudousxd/nestjs-client": minor
---

feat: ecosystem improvements across the codegen toolchain.

- **Typed per-route errors (`Route.Error<K>` now real).** Each emitted leaf route carries a real `error` type, discovered statically from a `defineContract({ error })` schema or a 4xx/5xx `@ApiResponse({ status, type })` decorator. `ApiHttpError` is generic so `err.body` can be narrowed to a route's `Route.Error<K>`.
- **Discriminated-union DTO support (zod / valibot / arktype).** class-transformer's `@Type(() => Base, { discriminator })` is detected and emitted as a proper tagged union (`z.discriminatedUnion`, `v.variant`, arktype alternation), with each subtype hoisted as a named schema.
- **Generic wrapper type fidelity (e.g. `PaginatedDto<T>`).** Generic wrapper DTOs substitute their type parameters when resolving both the validation IR and the inline TS type strings, so `PaginatedDto<Item>` resolves to its real shape instead of degrading to `unknown`.
- **SSE / streaming response typing.** Server-sent-event and streaming endpoints are recognized and emitted with accurate response types.
- **Cross-file `@ApplyContract` identifier resolution.** Contract identifiers referenced from other files are resolved across the project, including unresolvable-reference handling.
- **Configurable infinite-query pagination / cursor selector.** TanStack infinite-query generation supports a configurable pagination and cursor selector.
- **OpenAPI 3.1 export.** The IR can be exported to an OpenAPI 3.1 document.
- **MSW + mock generation.** Generates MSW handlers and mock data from the discovered IR.
- **Dual ESM/CJS packaging + exports/types fixes.** Packages ship dual ESM/CJS builds with corrected `exports` and `types` resolution.
