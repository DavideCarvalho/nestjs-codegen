---
'@dudousxd/nestjs-codegen': minor
---

Discover controller factories called through a property, and warn — loudly —
when a factory heritage clause cannot be followed at all.

A controller whose base came from anything other than a bare function name
contributed ZERO routes to the generated client:

```ts
class A extends tables.createTableController(Entity, {}) {} // namespace import
class B extends TableFactory.create(Entity, {}) {}          // static method
class C extends factories.table(Entity, {}) {}              // re-export object
```

Discovery required the callee of the factory call to be an `Identifier`, so each
of these resolved to nothing — and unlike the earlier filter gaps, this does not
mutilate a route's contract, it deletes the whole controller. `tsc` green,
codegen green, no warning: the first sign is a client call that does not exist.

The callee is now resolved through its name node, which covers a namespace import
(`ns.factory(...)`), a static method (`Factory.create(...)`) and a property of a
re-export object (`factories.table(...)`, including the `{ createTableController }`
shorthand). Bare identifiers are unchanged. A callee with no name node — an
element access (`factories['table'](...)`) or a callee that is itself a call
(`makeFactory()(Entity)`) — would mean evaluating the program to name the
function, so it stays unresolved.

Unresolved is no longer silent. A `@Controller`-decorated class whose heritage is
a factory-shaped CALL that discovery cannot follow now prints one line naming the
file, the class, the callee and what it costs:

```
[nestjs-codegen/fast] SearchUtilsController in /src/utils/search.controller.ts
extends makeTableController()(...) but its callee is not a name that can be
resolved statically — it contributes NO routes to the generated client.
```

Scoped tightly on purpose: it is a warning and never a throw, and it stays quiet
for `extends SomeBaseClass` (not a call) and for any class without `@Controller`
(extending a call expression is ordinary code). So the next unsupported shape
costs a line on stderr instead of a day.

`MixinBinding.factoryName` now carries the resolved DECLARATION's name rather
than the call-site text — a qualified `tables.createTableController` would never
match the by-name lookup consumers do inside `factoryFilePath`. Identical for
every existing bare-identifier call site, bar an import alias, where the
declaration name is the one that resolves.
