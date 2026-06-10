# nestjs-codegen

Extensible codegen for **NestJS** — generate typed client artifacts from your
controllers, contracts, and DTOs. Designed to work **with or without Inertia.js**.

Three independent extension axes:

1. **Pluggable validation** — emit [zod](https://zod.dev) (default),
   [valibot](https://valibot.dev), or [arktype](https://arktype.io) from one
   neutral schema IR, via adapters designed around the
   [Standard Schema](https://standardschema.dev) spec.
2. **Optional TanStack Query** — opt-in, framework-agnostic `queryOptions` /
   `mutationOptions` from `@tanstack/query-core`.
3. **Optional superjson** — opt-in transformer wiring that preserves rich types.

The Inertia.js integration lives in
[`nestjs-inertia`](https://github.com/DavideCarvalho/nestjs-inertia) as a preset
that consumes this core.

## Packages

| Package | Role |
|---|---|
| `@dudousxd/nestjs-codegen` | Core: schema IR, validation adapter system + bundled zod adapter, class-validator DTO discovery, and the `routes.ts`/`api.ts`/`forms.ts` emit pipeline. |
| `@dudousxd/nestjs-codegen-valibot` | Valibot adapter. |
| `@dudousxd/nestjs-codegen-arktype` | ArkType adapter. |
| `@dudousxd/nestjs-client` | Framework-neutral runtime (typed fetcher + superjson hook) the generated `api.ts` imports in plain mode. |

## Status

Extracted from `nestjs-inertia`'s codegen into this standalone repo. All five
foundations are implemented and tested (83 tests):

- **Separate lib** — this repo, 4 packages.
- **Pluggable validation** — neutral `SchemaNode` IR → zod / valibot / arktype adapters
  (Standard-Schema-shaped interface; reproduces the original zod output byte-for-byte).
- **Optional TanStack Query** — `query: true` emits framework-agnostic
  `queryOptions`/`mutationOptions` from `@tanstack/query-core`.
- **Optional superjson** — a `transformer` on the runtime fetcher round-trips rich
  types (Date, Map, …) end-to-end.
- **nestjs-inertia integration** — `mutationClient: 'inertia'` emits Inertia router
  visits for mutations while keeping typed GET reads.

Next: port the full NestJS controller/contract discovery (controllers → `RouteDescriptor[]`),
the CLI/watch, and ship the Inertia preset package in `nestjs-inertia`.

## Quick example

```ts
import { generate } from '@dudousxd/nestjs-codegen';

await generate(routes, {
  outDir: 'src/generated',
  validation: 'zod',     // or import { valibotAdapter } / { arktypeAdapter }
  query: true,           // emit TanStack queryOptions/mutationOptions
  transformer: 'superjson',
  mutationClient: 'fetcher', // or 'inertia'
});
```

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
