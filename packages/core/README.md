# @dudousxd/nestjs-codegen

> Extensible typed-client codegen for NestJS — routes, API client, and validation schemas.

![npm](https://img.shields.io/npm/v/@dudousxd/nestjs-codegen)

`nestjs-codegen` reads your NestJS controllers, `defineContract` contracts, DTOs, and
(optionally) Inertia pages via [ts-morph](https://ts-morph.com), builds a neutral schema
IR, and emits a **fully-typed client**: a route map, a Tuyau-style API client, and
client-side validation schemas. It works **with or without Inertia.js**, and every moving
part is pluggable — the validation library, the HTTP client, the serializer, and the query
layer.

## Install

```bash
pnpm add -D @dudousxd/nestjs-codegen
# a validation adapter (no adapter is bundled in core) — zod shown; or -valibot / -arktype:
pnpm add -D @dudousxd/nestjs-codegen-zod
# the runtime the generated client imports its Fetcher type from:
pnpm add @dudousxd/nestjs-client
```

The generated `api.ts` imports its `Fetcher` type from `@dudousxd/nestjs-client`, so it's a
real runtime dependency. `@nestjs/common`, `tsx`, and `typescript` are peer dependencies
(`@nestjs/common` and `tsx` are optional — your Nest app already has them).

## Quick start

Import `NestjsCodegenModule` into your root module. The codegen starts with your dev server
and regenerates the client as you edit your controllers — no config file, no extra process.
The watcher is a dev/CI concern, so the module skips itself automatically when
`NODE_ENV === 'production'`.

```ts title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { NestjsCodegenModule } from '@dudousxd/nestjs-codegen/nest';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';

@Module({
  imports: [
    NestjsCodegenModule.forRoot({
      // controllers to scan for routes + contracts
      contracts: { glob: 'src/**/*.controller.ts' },
      // output directory for the generated files
      codegen: { outDir: 'src/generated' },

      validation: zodAdapter, // zodAdapter | valibotAdapter | arktypeAdapter
    }),
  ],
})
export class AppModule {}
```

The generated `api.ts` exports a `createApi(fetcher)` factory — create the client once,
injecting your fetcher. Each endpoint is a **unified awaitable handle**: `await` it to run
the request.

```ts title="src/lib/api.ts"
import { createApi } from '../generated/api';
import { createFetcher } from '@dudousxd/nestjs-client';

export const api = createApi(createFetcher({ baseUrl: '/api' }));

const users = await api.users.list();              // typed User[]
const created = await api.users.create({ body });  // typed body + response
```

## What it generates

The codegen writes these files into your output directory:

- **`routes.ts`** — a `ROUTES` map, a `RouteName` union, and a typed `route()` helper.
- **`api.ts`** — a Tuyau-style `createApi(fetcher)` factory, nested by route name, fully typed.
- **`forms.ts`** — a validation schema per validated endpoint, in your chosen lib.
- **`pages.d.ts` / `components.json`** — when the Inertia integration is enabled.

## Extensions & the ecosystem

Everything beyond the core is pluggable. Extensions are registered via `extensions: [...]`;
validation adapters via `validation: ...`.

```ts title="src/app.module.ts"
import { NestjsCodegenModule } from '@dudousxd/nestjs-codegen/nest';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';
import { nestjsFilterCodegen } from '@dudousxd/nestjs-filter-codegen';
import { nestjsInertiaCodegen } from '@dudousxd/nestjs-inertia-codegen-extension';
import { arktypeAdapter } from '@dudousxd/nestjs-codegen-arktype';

NestjsCodegenModule.forRoot({
  contracts: { glob: 'src/**/*.controller.ts' },
  codegen: { outDir: 'src/generated' },
  validation: arktypeAdapter, // render the IR as arktype instead of zod
  extensions: [tanstackQuery(), nestjsFilterCodegen(), nestjsInertiaCodegen()],
});
```

When the TanStack extension is registered, every generated leaf becomes a unified handle:
`await api.users.show({ params })` performs the request, and the *same* handle carries
`.queryOptions()` / `.mutationOptions()` / `.infiniteQueryOptions()` / `.queryKey()`.

```tsx title="users-page.tsx"
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

const users = useQuery(api.users.list().queryOptions());
const create = useMutation(api.users.create().mutationOptions());
```

| Package | What it adds |
| --- | --- |
| [`@dudousxd/nestjs-client`](https://www.npmjs.com/package/@dudousxd/nestjs-client) | The runtime fetcher — `createFetcher` with a pluggable transport (native `fetch` or `axiosTransport()`) and a superjson hook. Pass it to `createApi(fetcher)`. |
| [`@dudousxd/nestjs-codegen-tanstack`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-tanstack) | TanStack Query helpers (`queryOptions` / `mutationOptions` / `infiniteQueryOptions` / `queryKey`) on each generated leaf. Registered as an extension. |
| [`@dudousxd/nestjs-codegen-arktype`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-arktype) | Validation adapter — render `forms.ts` as [arktype](https://arktype.io). Pass via `validation: arktypeAdapter`. |
| [`@dudousxd/nestjs-codegen-valibot`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-valibot) | Validation adapter — render `forms.ts` as [valibot](https://valibot.dev). Pass via `validation: valibotAdapter`. |
| [`@dudousxd/nestjs-filter-codegen`](https://www.npmjs.com/package/@dudousxd/nestjs-filter-codegen) | Extension — typed `filterQuery` helpers from the [nestjs-filter](https://github.com/DavideCarvalho/nestjs-filter) repo. |
| [`@dudousxd/nestjs-inertia-codegen-extension`](https://www.npmjs.com/package/@dudousxd/nestjs-inertia-codegen-extension) | Extension — Inertia `router` / navigate output from the nestjs-inertia repo. |

Write your own against the `@dudousxd/nestjs-codegen/extension` contract:

```ts
import { defineExtension, type CodegenExtension } from '@dudousxd/nestjs-codegen/extension';
```

## CLI

For CI (before deploy) you want a one-shot, watch-free run that fails the build if the
committed client has drifted. The package ships the `nestjs-codegen` CLI:

```bash
npx nestjs-codegen codegen   # one-shot generate (CI); pair with `git diff --exit-code`
npx nestjs-codegen init      # scaffold nestjs-codegen.config.ts
npx nestjs-codegen doctor    # diagnose your setup
```

The CLI reads `nestjs-codegen.config.ts` (the legacy `nestjs-inertia.config.ts` name is
still accepted) from your project root. Keep a single source of truth by authoring options
with `defineConfig` and importing them into `forRoot()`:

```ts title="nestjs-codegen.config.ts"
import { defineConfig } from '@dudousxd/nestjs-codegen';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';

export default defineConfig({
  contracts: { glob: 'src/**/*.controller.ts' },
  codegen: { outDir: 'src/generated' },
  validation: zodAdapter,
});
```

```bash
npx nestjs-codegen codegen
git diff --exit-code src/generated   # non-zero if the client is stale
```

## Documentation

Full docs — getting started, configuration, validation adapters, the fetcher, and the
extension contract — live in the repo:

- Repository & docs: https://github.com/DavideCarvalho/nestjs-codegen

## License

MIT
