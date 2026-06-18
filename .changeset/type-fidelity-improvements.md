---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-zod": minor
"@dudousxd/nestjs-codegen-valibot": minor
"@dudousxd/nestjs-codegen-arktype": minor
"@dudousxd/nestjs-client": minor
---

feat(codegen): type-fidelity improvements.

- **Typed errors per route (`Route.Error<K>` / `Path.Error<M, U>`).** The emitted leaf type block now carries an `error` field, so the previously-dead `Route.Error<K>` resolves to a real type. The error type is discovered statically from either a `defineContract({ error })` zod schema or an `@ApiResponse({ status, type })` decorator whose `status` is a 4xx/5xx code (the least-magic signal — it reuses the Swagger decorator NestJS apps already write). Routes without a declared error type resolve to `unknown` (an HTTP error always carries some body). `ApiHttpError` is now generic (`ApiHttpError<TBody = unknown>`) so `err.body` can be narrowed to a route's `Route.Error<K>`.
- **Discriminated-union DTOs.** class-transformer's `@Type(() => Base, { discriminator: { property, subTypes } })` is now detected and emitted as a proper tagged union: zod `z.discriminatedUnion`, valibot `v.variant`, arktype tuple alternation (`[a, "|", b]`). Each subtype is hoisted as a named schema.
- **Generic wrapper fidelity (`PaginatedDto<T>`).** Generic wrapper DTOs now substitute their type parameters when resolving both the neutral validation IR (so a field typed `T`/`T[]` resolves faithfully instead of degrading to `unknown`) and the inline TS type strings used for body/query/response. `PaginatedDto<Item>` now resolves to its real shape rather than `{ data: Array<unknown> }`.

Backward-compatible: the only golden change is the new `error` field on each emitted leaf type.
