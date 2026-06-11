---
"@dudousxd/nestjs-codegen-zod": minor
---

New package `@dudousxd/nestjs-codegen-zod` exporting `zodAdapter`, the zod validation
adapter extracted from core. It renders the neutral schema IR into zod source for the
generated `forms.ts`. Register it via `defineConfig({ validation: zodAdapter })`.

This is the canonical home for the zod adapter: core no longer bundles it (see the
`@dudousxd/nestjs-codegen` changelog), so install this package and pass
`validation: zodAdapter` explicitly.
