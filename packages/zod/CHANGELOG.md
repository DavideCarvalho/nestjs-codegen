# @dudousxd/nestjs-codegen-zod

## 0.4.0

### Minor Changes

- ed04cdc: Validate recursive DTOs instead of degrading them to `unknown`.

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

### Patch Changes

- d14fa68: Widen the `@dudousxd/nestjs-codegen` peer dependency range to `>=0.3.0 <1` so a core
  minor bump (e.g. 0.3.0 → 0.4.0) no longer falls out of the adapters' caret range and
  triggers a spurious **major** bump for every adapter. The codegen family versions in 0.x
  lockstep; the peer range now tolerates the whole 0.x line.

## 0.3.0

### Minor Changes

- c6417af: New package `@dudousxd/nestjs-codegen-zod` exporting `zodAdapter`, the zod validation
  adapter extracted from core. It renders the neutral schema IR into zod source for the
  generated `forms.ts`. Register it via `defineConfig({ validation: zodAdapter })`.

  This is the canonical home for the zod adapter: core no longer bundles it (see the
  `@dudousxd/nestjs-codegen` changelog), so install this package and pass
  `validation: zodAdapter` explicitly.

### Patch Changes

- Updated dependencies [b0fcd58]
  - @dudousxd/nestjs-codegen@0.3.0
