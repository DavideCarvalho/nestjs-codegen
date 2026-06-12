---
"@dudousxd/nestjs-codegen": patch
---

Fix array detection for union types. A property typed `unknown | unknown[]` (or any
union whose text happens to end in `[]`) was mistakenly treated as an array and wrapped
in `z.array(...)`. Array detection now uses the AST (`ArrayTypeNode`) instead of a
`.endsWith('[]')` text check, so only genuine `T[]` properties become arrays.
