---
"@dudousxd/nestjs-client": minor
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-codegen-tanstack": patch
---

Make the generated client type-check for controllers with `@Head()`, `@Options()` and `@All()` routes.

Discovery recognized all three decorators, and `api.ts` called `fetcher.head`, `fetcher.options` and `fetcher.all` for them — none of which the `Fetcher` had, so one such route anywhere in the app broke the generated file's type-check. Apps worked around it by augmenting `Fetcher` with stubs that throw.

- **`@dudousxd/nestjs-client`**: the `Fetcher` gains `head()` and `options()`. `head()` resolves to `undefined` on a 2xx (a HEAD response has no body) and still rejects a non-2xx with `ApiHttpError`; `options()` parses its body like any verb. A response with an empty body labelled `application/json` now resolves to `undefined` instead of throwing in `JSON.parse`.
- **`@dudousxd/nestjs-codegen`**: an `@All()` route gets no client method. It answers every verb, so there is no single request a typed method could issue, and in practice it is a protocol endpoint (an MCP transport, a proxy, a webhook sink) driven by a dedicated client rather than by the app's UI. Mapping it onto one verb would type a request the handler may not mean, and a method-parameterized call would be an untyped escape hatch the fetcher already has (`fetchRaw`). It keeps its `routes.ts` entry, so `route('mcp.handle')` still builds its URL, and it is left out of `openapi.json`, where "any method" is not a valid operation. `RequestModel['method']` (read by client-layer extensions) now includes `'head'` and `'options'`.
- **`@dudousxd/nestjs-codegen-tanstack`**: import decisions ignore `@All()` routes, matching the leaves core emits.

A `@Head()`/`@Options()` route now needs `@dudousxd/nestjs-client` 0.9 or later, or a custom fetcher (`fetcherImportPath`) that has both methods.
