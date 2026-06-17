---
"@dudousxd/nestjs-codegen": patch
---

perf: memoize type and enum resolution during generation — per-`Project` `WeakMap` caches for `findType`, `resolveTypeRef`'s named-symbol arm, and `resolveEnumValues`, so a type referenced N times is resolved once. Keyed by `Project` so each (watch) run gets a fresh cache; generated output is byte-identical.
