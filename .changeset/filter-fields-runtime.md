---
'@dudousxd/nestjs-codegen': minor
---

Emit `filterFields` as a runtime `as const` array on each filter leaf, alongside the existing type-level union, plus an `isFilterField` type guard exported from the generated `api.ts`. Previously the filterable field set existed only as a type, so a field name arriving as a plain `string` from runtime state (a saved view, a user-picked column) could not be passed to `filterQuery().where()` without a cast. Now `api.route.leaf().filterFields` is a `readonly [...] as const` value and `isFilterField(leaf.filterFields, value)` narrows an arbitrary string to the field union, so dynamic field names validate at runtime instead of being asserted with `as`. The runtime array is generated from the same discovered field list as the type-level union (single source in the emitter), so the value can never drift from the type. Purely additive — the guard is emitted only when a route carries filter fields, and leaves without a filter gain no new member.
