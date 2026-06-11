---
"@dudousxd/nestjs-codegen-zod": minor
---

New package `@dudousxd/nestjs-codegen-zod` exporting `zodAdapter`, the zod validation
adapter extracted from core. It renders the neutral schema IR into zod source for the
generated `forms.ts`. Register it via `defineConfig({ validation: zodAdapter })`.

This is non-breaking: core still bundles and re-exports `zodAdapter` and keeps `'zod'`
as the default, so existing setups are unaffected.
