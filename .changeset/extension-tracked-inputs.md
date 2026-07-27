---
'@dudousxd/nestjs-codegen': minor
---

Extensions can declare input files the host's globs don't cover, via `ExtensionContext.trackInput`.

The skip-when-unchanged hash is built from `contracts.glob`, `forms.watch` and `pages.glob`. An extension that reads outside them therefore produced output that nothing could invalidate: `@dudousxd/nestjs-filter-codegen` resolves each route's `@ApplyFilter(FilterClass)` target and turns its `@Computed` / `@Filterable({ computed })` declarations into `filterFields` entries, but a filter class matches none of those globs — so editing one left the hash untouched and the next run reported "up to date, skipped" while serving stale types. The only way out was deleting `outDir`.

Extensions like that cannot declare their inputs up front (they need the discovered routes to know which files to read), so this works like a compiler depfile instead: paths reported during a run are recorded in the manifest as `extraInputs`, and the next run folds their contents into the hash. A file that becomes a dependency for the first time is picked up on the run after it is first read — in practice not a gap, since wiring a new filter class also edits a controller, which the globs already cover.

Deleting a tracked file invalidates too (it hashes as a `missing` marker rather than throwing), and a tracked path a glob already covers is hashed once, not twice.

Purely additive for existing extensions. `trackInput` is a no-op on the standalone `emitApi` path, which writes no manifest.
