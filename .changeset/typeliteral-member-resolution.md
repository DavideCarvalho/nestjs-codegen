---
'@dudousxd/nestjs-codegen': patch
---

Resolve the members of an inline object-literal type (`{ a: Foo; b: Bar }`) in response/stream types instead of emitting the node's raw text. A named type nested in an object literal — most commonly an SSE payload's `Observable<{ data: SomeType }>`, where `SomeType` is imported from another package — was previously copied verbatim, leaving a bare, unimported identifier that is undefined in the generated file. Each member's type is now resolved (expanded inline, or reduced to `unknown` when unresolvable) like any other named reference.
