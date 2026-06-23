---
"@dudousxd/nestjs-codegen": patch
---

fix(core): load the TypeScript config via Node's native type-stripping first, falling back to tsx — unblocks the codegen CLI on Node 25 where tsx 4.22.4's resolver appends a `?namespace=<ts>` query that Node 25's stricter `finalizeResolution` rejects with `ERR_MODULE_NOT_FOUND`. tsx remains the fallback for older Node versions without native type stripping.
