# @dudousxd/nestjs-codegen-arktype

> ArkType validation adapter for [`@dudousxd/nestjs-codegen`](https://github.com/DavideCarvalho/nestjs-codegen).

![npm](https://img.shields.io/npm/v/@dudousxd/nestjs-codegen-arktype)

`nestjs-codegen` translates your `@Body()`/`@Query()` DTOs and `defineContract`
schemas into one neutral schema IR (`SchemaNode`). A **validation adapter** renders
that IR into a concrete library's source inside the generated `forms.ts`. This package
renders it to [**arktype**](https://arktype.io).

## Install

```bash
pnpm add -D @dudousxd/nestjs-codegen-arktype
```

The generated `forms.ts` imports from `arktype` at runtime, so install it as a regular
dependency in the consuming app:

```bash
pnpm add arktype
```

## Setup

Pass `arktypeAdapter` to the codegen config's `validation` option:

```ts
import { defineConfig } from '@dudousxd/nestjs-codegen';
import { arktypeAdapter } from '@dudousxd/nestjs-codegen-arktype';

export default defineConfig({
  validation: arktypeAdapter,
});
```

Given a DTO like:

```ts
class CreateUserDto {
  @IsEmail() email!: string;
  @MinLength(8) password!: string;
}
```

the adapter emits arktype source in `forms.ts`:

```ts
import { type } from 'arktype';

export const CreateBodySchema = type({
  email: 'string.email',
  password: 'string >= 8',
});
export type CreateBody = (typeof CreateBodySchema).infer;
```

## How it fits

The core builds the IR once; adapters render it. No adapter is bundled in core — pick
**zod** ([`@dudousxd/nestjs-codegen-zod`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-zod)),
**valibot** ([`@dudousxd/nestjs-codegen-valibot`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-valibot)),
or **arktype** (this package) by passing its adapter to `validation`. Pick one: the
emitted schemas are written entirely in the chosen library's idiom.

> `defineContract` schemas are hand-written zod. Under the arktype adapter they're
> skipped with a warning — use class-validator DTOs for cross-adapter forms.

## Documentation

- [Pluggable Validation](https://github.com/DavideCarvalho/nestjs-codegen) — choosing an adapter, decorator coverage, writing your own.
- Repository: https://github.com/DavideCarvalho/nestjs-codegen

## License

MIT
