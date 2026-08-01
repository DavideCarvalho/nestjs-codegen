---
'@dudousxd/nestjs-codegen': minor
---

Classify through transparent type brands, so a MikroORM entity's columns stop coming back `unknown`.

`Opt<T>` is how MikroORM marks a column optional on insert, and it is how nearly every nullable column in a MikroORM entity is written. It is a compile-time marker with no runtime shape of its own — an `Opt<string>` column holds a string — but the classifier saw a type reference it did not recognise and answered `unknown`. On a real entity that meant 31 of 35 fields unclassified, including plain `Opt<string>` names; the four that worked were the two written as bare primitives and the two written `Date & Opt<Date>`, where the intersection happens to expose a type the classifier already knew.

That is not a cosmetic gap. `unknown` is indistinguishable from "the classifier could not tell", so every consumer that reads a kind — operator sets, a number/date gate, a UI picking a filter control from the column's type — has to fall back to permissive for an entity that had in fact declared its types perfectly well.

`Opt<T>` and `Hidden<T>` are now unwrapped to their argument, recursively, so `Opt<Hidden<number>>` is a number.

Deliberately a short allowlist rather than "unwrap any single-argument reference". `Ref<T>`, `Rel<T>`, `Collection<T>` and `IdentifiedReference<T>` are **not** transparent: their runtime value is a reference or a collection, not a `T`. Unwrapping those would classify a relation as whatever its target's shape happens to be — silently, and only visibly far downstream.
