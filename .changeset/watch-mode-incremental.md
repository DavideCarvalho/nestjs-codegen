---
"@dudousxd/nestjs-codegen": patch
---

Watch mode no longer rebuilds its type-checked programs on every change. Schema inference's program and the program that types factory-built (mixin) controllers are kept across passes and re-read only the files that changed on disk, so a pass in a large app drops from seconds to a few hundred milliseconds; they are still built again when a watched file is created or deleted. A pass also notices edits to files outside the watched globs that discovery had loaded (a schema module a controller imports), which it used to serve stale until that file was named by a watch event. An import of a module that did not exist yet is also picked up once the module appears, even outside the watched globs.

A generate pass now reads each input file once: the skip-when-unchanged hash, the hash recorded after extensions report their dependencies, and page discovery share one read, done in parallel. Shared-props discovery reuses the parsed tsconfig while it is unchanged instead of re-parsing it, and walking the project tree, on every pass. Generated output is unchanged.
