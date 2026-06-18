---
"@dudousxd/nestjs-codegen": patch
---

perf: faster generation — `aliasFor` uses a maintained in-use-name set (O(n²)→O(1) over nested DTOs) and `planNestedSchemas` caches compiled rename regexes + uses a maintained Set for membership instead of rebuilding arrays. Generated output is byte-identical.
