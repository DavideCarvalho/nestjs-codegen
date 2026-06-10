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

| Package | Status |
|---|---|
| `@dudousxd/nestjs-codegen` | Core: schema IR + validation adapter system + class-validator DTO discovery. **In progress.** |
| `@dudousxd/nestjs-codegen-zod` | Default zod adapter (currently bundled in core). |
| `@dudousxd/nestjs-codegen-valibot` | Planned. |
| `@dudousxd/nestjs-codegen-arktype` | Planned. |

## Status

Early extraction from `nestjs-inertia`'s codegen. The foundation landing first is
the **neutral validation IR + `ValidationAdapter`** with a zod adapter that
reproduces the previous emitter byte-for-byte (see `packages/core`). Route/api/forms
emit and the CLI are being ported next.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
