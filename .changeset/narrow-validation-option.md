---
"@dudousxd/nestjs-codegen": minor
---

Narrow the public `ValidationOption` type to `ValidationAdapter` only. The string
shortcuts (`'zod'` / `'valibot'` / `'arktype'`) were advertised by the type but
`resolveAdapter` always threw a `ConfigError` for any string, so they never worked
at runtime. The type now guides TypeScript users to import and pass an adapter
instance (e.g. `zodAdapter` from `@dudousxd/nestjs-codegen-zod`).

The runtime guard is retained: `resolveAdapter` still accepts a `string` and throws
the helpful "install + import the adapter package" error, so JS callers and untyped
configs that pass a removed string shortcut get the same actionable message.

This is a compile-time-only breaking change for anyone still typing `validation:
'zod'` — it never produced working output at runtime, so the bump is minor.
