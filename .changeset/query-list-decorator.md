---
'@dudousxd/nestjs-codegen': minor
---

Add a `@QueryList()` param decorator and a `toStringList` normalizer to the `/nest` subpath for receiving array query params safely. Express (and Nest's default query parser) returns a bare `string` for a single-value query param (`?ids=a`) and a `string[]` only for two or more (`?ids=a&ids=b`), so `ParseArrayPipe` 400s the common single-select case. `@QueryList('ids')` normalizes `string | string[] | comma-joined string | undefined` into a clean `string[]` (`['a']`, `['a','b']`, `[]`), and `toStringList` is exported for the equivalent `class-transformer` `@Transform` on a DTO field. Pairs with the client's `arrayFormat` option: once the client sends `arrayFormat: 'repeat'`, the comma-split becomes a no-op fallback that still covers hand-rolled and `curl` callers. Documented under a new "Receiving array query params" docs page.
