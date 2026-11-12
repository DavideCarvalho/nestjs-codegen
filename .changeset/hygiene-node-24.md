---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-client": minor
"@dudousxd/nestjs-codegen-arktype": minor
"@dudousxd/nestjs-codegen-tanstack": minor
"@dudousxd/nestjs-codegen-valibot": minor
"@dudousxd/nestjs-codegen-zod": minor
---

**Breaking:** require Node.js 24 or newer (`engines.node` is now `>=24`, was `>=20`). CI tests on Node 24 and 26.

Also removed (see the Upgrading page in the docs):

- `@dudousxd/nestjs-codegen`: the deprecated top-level `scopes` config option, which had no effect, and its `ScopeConfig` type. Use `pages.scopes` for several Inertia apps, or one brace glob in `contracts.glob` for several controller sets.
- `@dudousxd/nestjs-codegen`: `genuiSandboxKit()` no longer throws a migration error for its pre-0.28 option names (`include`/`entry` → `components`, `css` → `styles`). TypeScript reports them as unknown options.
- `@dudousxd/nestjs-client`: `TransportResponse.headers` is required. A custom `Transport` returns every response header, with lower-cased keys (`Object.fromEntries(res.headers)` with `fetch`).
