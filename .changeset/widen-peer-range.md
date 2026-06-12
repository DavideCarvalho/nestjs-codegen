---
"@dudousxd/nestjs-codegen-zod": patch
"@dudousxd/nestjs-codegen-valibot": patch
"@dudousxd/nestjs-codegen-arktype": patch
"@dudousxd/nestjs-codegen-tanstack": patch
---

Widen the `@dudousxd/nestjs-codegen` peer dependency range to `>=0.3.0 <1` so a core
minor bump (e.g. 0.3.0 → 0.4.0) no longer falls out of the adapters' caret range and
triggers a spurious **major** bump for every adapter. The codegen family versions in 0.x
lockstep; the peer range now tolerates the whole 0.x line.
