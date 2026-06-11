# @dudousxd/nestjs-codegen-zod

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
