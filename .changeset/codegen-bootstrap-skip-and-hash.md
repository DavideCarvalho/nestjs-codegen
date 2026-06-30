---
"@dudousxd/nestjs-codegen": minor
---

perf(core): make the boot-time watcher production-safe, non-blocking, and idempotent.

Three changes to the `NestjsCodegenModule` `onApplicationBootstrap` path so dev-watch
restarts no longer pay the full codegen cost on time-to-ready:

- **Skip in production.** `NODE_ENV` is now normalized (trimmed + lowercased) before the
  production check, and the watcher is skipped with a single concise log line when it is
  `production`. A new `runInProduction?: boolean` option (default `false`) forces it on if
  ever needed; explicit `enabled` still overrides both.

- **Non-blocking boot.** The initial discover + generate triggered by
  `onApplicationBootstrap` now runs fire-and-forget (`watch(config, undefined, { deferInitialGenerate: true })`)
  so it no longer blocks `NestFactory.create`. The lock and the chokidar watchers are
  still set up synchronously, lock NO_OP semantics are preserved, and a rejected initial
  generate is caught and logged rather than crashing the process. The one-shot CLI
  (`nestjs-codegen codegen`) stays fully synchronous.

- **Skip-when-unchanged.** `generate()` now records a content hash (over all discovered
  controller/DTO/page source files + the serialized resolved config + the lib version) and
  the emitted output file list in `<outDir>/.codegen-manifest.json`. When the hash matches
  and every recorded output still exists, the pass is skipped — stopping HMR from rewriting
  `api.ts` (and churning downstream `tsbuildinfo`) when nothing changed. Any input change,
  a missing output, or a lib upgrade invalidates the manifest and regenerates.
