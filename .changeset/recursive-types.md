---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-zod": minor
"@dudousxd/nestjs-codegen-valibot": minor
"@dudousxd/nestjs-codegen-arktype": minor
---

Validate recursive DTOs instead of degrading them to `unknown`.

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
