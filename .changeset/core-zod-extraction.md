---
"@dudousxd/nestjs-codegen": minor
---

BREAKING (0.x minor bump): `validation` is now a required config field, and the zod
adapter is no longer bundled in core.

- `zodAdapter` is no longer exported from `@dudousxd/nestjs-codegen`. Import it from
  `@dudousxd/nestjs-codegen-zod` instead.
- The `validation: 'zod'` string shortcut no longer resolves — like `'valibot'` and
  `'arktype'`, the string forms now throw, directing you to install the adapter
  package and pass the instance.
- `validation` must be provided. Both `loadConfig` (config file) and `resolveConfig`
  (`NestjsCodegenModule.forRoot`) throw a clear `ConfigError` when it is missing.

Migration:

```ts
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';

export default defineConfig({
  validation: zodAdapter,
  // ...
});
```

Adapters now advertise raw-zod passthrough via the new optional
`ValidationAdapter.acceptsRawZodSource` capability (set only by `zodAdapter`),
decoupling `emit-forms` from a hardcoded `'zod'` name check.
