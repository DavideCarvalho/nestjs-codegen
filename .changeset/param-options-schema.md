---
"@dudousxd/nestjs-codegen": minor
---

Read a NestJS 12 parameter decorator's `schema` option (`@Body({ schema })`, `@Query({ schema })`, `@Query('q', { schema })`, `@Param('id', { schema })`, validated by `StandardSchemaValidationPipe`) the same way as a schema pipe's argument, so the generated client types the request from the schema instead of `unknown`.
