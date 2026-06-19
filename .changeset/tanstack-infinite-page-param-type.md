---
"@dudousxd/nestjs-codegen-tanstack": patch
---

Fix: type the generated `infiniteQueryOptions` overrides' `getNextPageParam`/`getPreviousPageParam` as returning `number | null | undefined` (the page param type) instead of `unknown`. `unknown` failed to satisfy TanStack Query's `GetNextPageParamFunction<number, T>` overload, producing TS2769 errors at the call site in strict consumers. Runtime behavior is unchanged — only the emitted type annotation is corrected.
