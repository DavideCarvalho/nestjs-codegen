---
'@dudousxd/nestjs-codegen': minor
---

Describe a table's routes with the filter its factory was HANDED, not the one it
generated.

A factory given a hand-written filter through an option —
`createTableController({ entity: Wo, filter: WoFilter })` — applies `WoFilter` to
every route it produces, but the decorators inside the factory body can only name
the fallback it generates internally (`@ApplyFilter(GeneratedFilter)`; the
supplied class exists only at the call site). Discovery read that decorator
argument and nothing else, so everything emitted for those routes came from the
fallback:

- the hand-written filter's `@FilterFor` virtual fields were **absent** from the
  client — filtering by them does not type-check, though the server accepts them;
- a filter that NARROWS with `allowed` was typed with the fallback's **wider**
  entity-derived field set — the client is told it may filter by fields the
  server will reject, which type-checks at the call site and fails at runtime.

The route's mixin binding already carried the call-site `filter` class. It is now
consulted, in this precedence (first candidate that yields a readable field set
wins):

1. a filter named BY IDENTIFIER in the route's own `@ApplyFilter(SomeFilter)` —
   an overriding method is the only place a per-route statement can be made;
2. the factory's `filter` option;
3. the existing walk — `@ApplyFilter(<Const>.filter)` through the factory static,
   a lexically-scoped local class, then a module-level lookup.

`@ApplyFilter(<Const>.filter)` sits below (2) deliberately, matching
`@dudousxd/nestjs-filter-codegen`: it forwards the factory's product rather than
naming a filter of its own, so statically it always lands on the generated
fallback.

Two consequences follow:

- **`allowed` / `blocked` now narrow the emitted field set.** They gate exactly
  the auto-field set, so they are applied to the entity-derived fields;
  `@FilterFor` keys are appended afterwards, as the runtime resolves an explicit
  handler without consulting `allowed`.
- **A hand-written filter's own `@Filterable({ entity })` wins** over the
  factory's call-site entity. The call-site entity is a repair for a GENERATED
  filter, whose `entity` names the factory's parameter and resolves to nothing; a
  hand-written filter names a real class, and that is the class the runtime
  queries. It stays a fallback for when the declared entity does not resolve.

Nothing gets worse: a candidate that resolves but reads as empty (no properties,
no `@Filterable`, no `@FilterFor`) is skipped rather than returned, so an opaque
call-site filter degrades to today's result instead of to `filterFields: never`.
