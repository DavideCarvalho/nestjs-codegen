---
'@dudousxd/nestjs-codegen': minor
---

Resolve the entity of a controller factory called with a single options object.

`class X extends createTableController({ entity: Util, dto: UtilDTO })` emitted
every one of its routes with `body: never` and `filterFields: never` — the typed
filter builder gone from the client, with `tsc` and codegen both green. Only the
positional form (`createTableController(Util, { dto })`) worked: discovery
collected call-site classes by scanning for identifier ARGUMENTS, and an object
literal is not one, so the entity behind the factory's generated
`@Filterable({ entity })` was unresolvable. Measured downstream at 22 tables
losing their filter builder at once.

Class-valued properties of an options-object argument are now collected too,
keyed by property name, and the entity resolver prefers a named `entity` over the
first positional argument. Both call forms work, so a codebase can migrate table
by table.

`MixinBinding` gains `namedClassArgs: Record<string, { name, filePath }>`
alongside the unchanged positional `classArgs`. The key is what identifies an
argument's role once there is no positional order to read it from, and consumers
want different properties: this package resolves `entity`, while
`@dudousxd/nestjs-filter-codegen` reads `filter` off the same binding.
