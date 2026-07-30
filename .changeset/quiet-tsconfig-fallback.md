---
'@dudousxd/nestjs-codegen': patch
---

Load the consumer tsconfig without walking their file tree, and stop falling back from it in silence

`createDiscoveryProject` handed `tsConfigFilePath` to ts-morph and wrapped the
call in a bare `try/catch` that, on ANY error, rebuilt the `Project` with no
tsconfig at all. Both halves of that were a problem.

Parsing a tsconfig also resolves its FILE LIST, and a tsconfig with no `include`
defaults to `**/*` — so TypeScript walks every directory under the project root.
One directory the codegen process cannot read is enough to throw
`EACCES: permission denied, scandir ...` and take the whole tsconfig down with
it; a docker bind mount that a container has chowned to its own UID with
mode-700 subdirs (Grafana, Prometheus, MinIO, a DB data dir) is exactly that
shape. `skipAddingFilesFromTsConfig` did not help, because it discards the file
list only after it has been computed.

Discovery never wanted that list — only `paths`/`baseUrl`/`target`/decorator
flags — so the tsconfig is now read through `ts.readConfigFile` +
`ts.parseJsonConfigFileContent` with a host whose `readDirectory` returns
nothing, and the parsed options are passed to `new Project({ compilerOptions })`.
No directory is read, so no unreadable one can matter. `extends` still resolves,
and passing the parsed options through wholesale preserves TypeScript's
`pathsBasePath` (how `paths` resolves when the tsconfig sets no `baseUrl`).

The silent fallback is what made this expensive to diagnose. A `Project` with no
tsconfig has no `paths`, and go-to-definition is how a factory-based controller
(`class X extends createTableController(...)`) is resolved — so an
alias-imported factory stops resolving and every route those controllers
contribute disappears from the generated client. The only output was the
per-controller `contributes NO routes` warning, which blames the controller. A
tsconfig that exists but cannot be loaded now warns once, naming the tsconfig,
the underlying error and what it costs. A MISSING tsconfig stays silent: relative
imports need no `paths`, so a tsconfig-less consumer is a supported setup.

Measured against a real consumer with one unreadable directory in its root:
313 routes and 0 factory-derived routes with 22 `contributes NO routes`
warnings, versus 357 routes and 44 factory-derived routes with none.

Also folds the tsconfig into the generate manifest's input hash. The freshness
check ("up to date, skipped") did not cover it, so a tsconfig that made discovery
generate a WRONG artifact left that artifact on disk after the tsconfig was
fixed, and every later run skipped over it — the only way out was deleting
`.codegen-manifest.json` by hand. Raw contents are hashed rather than the
resolved options, because `include`/`exclude` are not compiler options and an
added `exclude` is exactly what such a fix tends to be. The whole `extends` chain
is hashed, not just the entry file, since that is where a shared `paths` block
usually lives.

Two things follow from loading the tsconfig properly, both previously wrong in the
same direction — an alias that silently resolved to nothing:

- `paths` now come from that single load, so a mapping declared in a tsconfig
  reached through `extends` is finally seen. The old reader parsed the entry
  file's raw JSON itself, so it saw neither `extends` nor block comments, and it
  could disagree with the options the `Project` was built from.
- Those mappings resolve the way `tsc` resolves them — against `baseUrl` when
  set, else against the directory of the file that DECLARED them (TypeScript's
  `pathsBasePath`). They were resolved against the project root, which is not the
  same directory for a `paths` block inherited from `config/base.json`, or for a
  `baseUrl` of `./src`.
