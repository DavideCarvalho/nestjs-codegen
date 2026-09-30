---
"@dudousxd/nestjs-client": patch
---

`Jsonify<T>` keeps an `any`-valued property `any` again. 0.9.1 typed it `undefined` (`{ id: any }` became `{ id: undefined }`): the check that keeps `x?: undefined` also matched `any`. The type-level specs of `Jsonify` are now compiled by the test run (`vitest` typecheck), which would have caught it.
