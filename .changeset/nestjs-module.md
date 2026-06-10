---
"@dudousxd/nestjs-codegen": minor
---

Add `NestjsCodegenModule.forRoot()` — a NestJS module (exported from
`@dudousxd/nestjs-codegen/nest`) that auto-starts the codegen watcher on app boot, the
recommended way to wire the codegen in dev. Import it into your `AppModule` and the typed
client regenerates as you edit controllers — no config file, no separate process. Skips the
watcher in production by default (`enabled`/`cwd` options to override); `@nestjs/common` is an
optional peer dependency. The one-shot CLI remains for CI/pre-deploy runs.

Also exposes `resolveConfig(userConfig, cwd?)` for resolving config in memory, and fixes the
watcher's incremental contracts pass to honor the full emit options (`query` /
`mutationClient` / `queryImport` / validation adapter) instead of silently dropping them on
each edit.
