---
'@dudousxd/nestjs-codegen': patch
---

Resolve `@ApplyFilter(<Table>.filter)` on overridden mixin routes.

A controller that extends a factory-produced base and overrides one of its
routes has to re-declare `@ApplyFilter`, and the only handle on the filter the
factory generated internally is the static it hands back — a property access,
not an importable identifier. Discovery accepted identifiers only, so it skipped
the decorator entirely.

The failure was silent and total rather than partial: the route emitted with
`body: never` and `filterFields: never`, dropping the typed filter builder from
exactly the routes that took the override escape hatch, while `tsc` and codegen
both stayed green. It only surfaced downstream, as a client call that could no
longer be typed.

Such a property access is now resolved through the factory — const → factory
call → returned class → static property → the class declared in the factory
body.
