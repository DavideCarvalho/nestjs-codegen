---
'@dudousxd/nestjs-codegen': minor
---

Hand extensions the tsconfig-seeded Project instead of making each build its own

`ExtensionContext` gains `tsconfigProject()`: a lazily-created, memoized ts-morph
`Project` built from the consumer's tsconfig (`app.tsconfig`, else
`<cwd>/tsconfig.json`), so `paths` aliases resolve. `project()` is unchanged — it
stays the bare, paths-less scratch project — and the two are now documented against
each other.

An extension that needs to follow a `@/api/...` import from a controller to the
decorator target it reads had no way to get one, so it built its own from
`tsConfigFilePath`. That has a trap: parsing a tsconfig also resolves its FILE LIST,
and a tsconfig with no `include` walks the entire project root, so one unreadable
directory (a docker bind mount a container chowned to its own UID) throws
`EACCES ... scandir`. Every hand-rolled copy then fell back to a paths-less Project
in silence, and aliased targets resolved to nothing with no error anywhere — the
same bug, once per extension. The host now loads it correctly, once, and hands it
out; N extensions share one parse instead of one each.

Typed as optional (`tsconfigProject?()`) on purpose: an extension may run against an
older host that does not provide it, so the ecosystem pattern is
`ctx.tsconfigProject?.() ?? <own fallback>`.
