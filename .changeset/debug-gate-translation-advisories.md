---
"@dudousxd/nestjs-codegen": minor
---

feat(core): gate schema-translation advisories behind a new `debug` config flag (default off).

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
