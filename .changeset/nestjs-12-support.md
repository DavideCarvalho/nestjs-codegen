---
'@dudousxd/nestjs-codegen': patch
'@dudousxd/nestjs-client': patch
---

Add NestJS 12 to the supported peer range.

`@dudousxd/nestjs-client`'s `@nestjs/common` peer read `^10.0.0 || ^11.0.0` and now also admits
`^12.0.0`. `@dudousxd/nestjs-codegen`'s peer already read `>=9.0.0`, so it admitted 12 unchanged;
its dev dependencies move onto the 12.x line so the suite runs against NestJS 12.

No source change was needed. NestJS 12 ships its core packages as pure ESM and these packages are
already `"type": "module"`; neither implements a `PipeTransform`, so the `ArgumentMetadata` generic
added in v12 does not reach this code, and neither subclasses `ConsoleLogger`.

The AST discovery path was exercised end-to-end against a real NestJS 12 application: the generated
client is byte-identical to the one produced before the bump, so v12's decorator and metadata
changes leave route and field discovery intact.
