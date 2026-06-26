---
"@dudousxd/nestjs-codegen": patch
---

fix(core): emit POSIX forward slashes in generated imports (Windows support).

The emitters built `import(...)` / `import ... from` specifiers straight from
`path.relative(...)`, which returns the platform separator. On Windows that meant
generated `api.ts`, `forms.ts`, and `pages.d.ts` contained backslash specifiers
(`import('..\\..\\src\\foo.controller')`), which TypeScript/bundlers reject — so
codegen output only worked on macOS and Linux.

All four call sites now go through a shared `toImportSpecifier(outDir, filePath, stripExt?)`
helper that normalizes separators to `/`. Page discovery likewise normalizes page
names and cached relative paths, so Inertia page names stay forward-slash (`Auth/Login`)
and `components.json` is identical across platforms. Output on macOS/Linux is unchanged.
