---
"@dudousxd/nestjs-codegen": minor
---

fix(core): emit a clean prefix `queryKey` when a query handle is called with no input.

Previously the generated `queryKey()` was always `[name, input]`, so calling it with
no argument produced `[name, undefined]` — a two-element key whose trailing `undefined`
does NOT partial-match the parametrized live queries (`[name, { params, query }]`).
That made the bare `api.x.y().queryKey()` useless for `invalidateQueries`: it silently
matched nothing.

The key now omits the trailing element when `input === undefined`
(`input === undefined ? [name] : [name, input]`), so `api.x.y().queryKey()` is a proper
prefix that partial-matches every parametrized variant. Invalidating a whole route is now
just `queryClient.invalidateQueries({ queryKey: api.x.y().queryKey() })` — no manual
key construction or slicing. Passing the real input still yields `[name, input]` for an
exact match. Keys carrying input are unchanged.
