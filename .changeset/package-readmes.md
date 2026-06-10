---
"@dudousxd/nestjs-codegen": patch
"@dudousxd/nestjs-client": patch
"@dudousxd/nestjs-codegen-tanstack": patch
"@dudousxd/nestjs-codegen-arktype": patch
"@dudousxd/nestjs-codegen-valibot": patch
---

docs: add a README to every published package and update the docs site to the extension architecture

Each package now ships a README (npm package pages were previously blank), and the
docs site documents integrations as registered `extensions: [...]` (the obsolete
`mutationClient` option is gone) with a new "Extensions" page covering the
`@dudousxd/nestjs-codegen/extension` contract.
