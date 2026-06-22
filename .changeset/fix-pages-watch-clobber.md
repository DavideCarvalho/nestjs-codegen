---
"@dudousxd/nestjs-codegen": patch
---

Fix watcher clobbering `api.ts` with an extension-only stub on page edits. The
pages fast path called `generate(config)` with no routes, so a route-injecting
extension (e.g. the notifications codegen) still emitted — overwriting the full
`api.ts` with just the injected namespace and dropping every contract-derived
route. The watcher now caches the last discovered routes (from the initial pass
and each contracts rediscovery) and reuses them for pages-only regenerations.
