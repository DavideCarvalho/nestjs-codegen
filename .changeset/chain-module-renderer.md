---
"@dudousxd/nestjs-codegen": patch
"@dudousxd/nestjs-codegen-zod": patch
"@dudousxd/nestjs-codegen-valibot": patch
---

Internal refactors (behavior-preserving): share `renderModule` across the zod/valibot adapters via a `createChainModuleRenderer` factory, and dedupe the nested-reference array-wrap + presence tail in `buildProperty` (`dto-to-ir`) behind a single `asField` closure.
