---
"@dudousxd/nestjs-client": minor
"@dudousxd/nestjs-codegen": minor
---

Jsonify-by-default serialized response types, with an opt-out `serialization` config option.

The generated `api.ts` now reflects the **JSON wire shape** of each route's response rather than the in-process server return type. A controller returning `{ createdAt: Date }` now generates `response: Jsonify<{ createdAt: string }>` — because `Date.prototype.toJSON()` emits an ISO string. `Jsonify<T>` recurses arrays/objects, follows any `toJSON()` holder to its returned shape, drops non-serializable properties (functions/symbols), keeps optional properties optional, and passes `any`/`unknown` through untouched. It is a hand-rolled, type-only utility with no runtime footprint.

- **`@dudousxd/nestjs-client`** exports the new `Jsonify<T>` type.
- **`@dudousxd/nestjs-codegen`** wraps each route `response` field in `Jsonify<...>` by default and emits `import type { Jsonify } from '<runtime>'` (tracking `fetcher.importPath`) when at least one route is wrapped. Only the `response` field is wrapped — never `error`, `body`, or `query`.
- New config option `serialization?: 'json' | 'superjson'` (default `'json'`). In `'superjson'` mode the raw controller return type is emitted unchanged (Dates/Maps/Sets are revived on the client), and no `Jsonify` import is emitted.
