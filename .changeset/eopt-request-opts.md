---
"@dudousxd/nestjs-client": patch
---

Allow explicit `undefined` on `RequestOpts`/`BuildUrlOptions` `params`/`query`. The
generated client passes `{ query: input?.query }` (possibly `undefined`); the fetcher
types now accept that under `exactOptionalPropertyTypes: true`, so the generated `api.ts`
type-checks in strict consumers.
