---
"@dudousxd/nestjs-client": patch
"@dudousxd/nestjs-codegen-tanstack": patch
---

Two fixes for apps that type-check the generated client.

- **`@dudousxd/nestjs-client`**: `Jsonify<T>` keeps an optional property whose only value is `undefined` (`error?: undefined`). TypeScript adds those to the members of an inferred union — the return type of a handler with two `return` branches is `{ ok: true; error?: undefined } | { ok: false; error: string }` — so the property can be read on the union. `Jsonify` dropped them as non-serializable, and `result.error` on the client became "Property 'error' does not exist on type …". A required `undefined`-only property and function-valued properties are still dropped.
- **`@dudousxd/nestjs-codegen-tanstack`**: `mutationOptions()` of a route without params, query or body names its unused `mutationFn` parameter `_input`, so `api.ts` compiles under `noUnusedParameters` with the TanStack layer too (it already did without it).
