# @dudousxd/nestjs-codegen-valibot

> Valibot validation adapter for [`@dudousxd/nestjs-codegen`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen).

![npm](https://img.shields.io/npm/v/@dudousxd/nestjs-codegen-valibot)

`nestjs-codegen` translates your `@Body()`/`@Query()` DTOs and `defineContract` schemas
into one neutral schema IR (`SchemaNode`), then renders that IR with a **validation
adapter**. This package is the **valibot** adapter: it renders the IR into valibot
source in the generated `forms.ts`.

Reach for valibot when bundle size matters — it's a tiny, tree-shakeable validator, so
only the actions your forms actually use end up in the client bundle.

## Install

```bash
pnpm add -D @dudousxd/nestjs-codegen-valibot
```

`valibot` itself is the runtime dependency your generated `forms.ts` imports from
(`import * as v from 'valibot'`), so install it in your app too:

```bash
pnpm add valibot
```

## Setup

No adapter is bundled in core. To emit valibot schemas, pass `valibotAdapter` to the
codegen config:

```ts
import { defineConfig } from '@dudousxd/nestjs-codegen';
import { valibotAdapter } from '@dudousxd/nestjs-codegen-valibot';

export default defineConfig({
  validation: valibotAdapter,
});
```

Given a DTO like:

```ts
class CreateUserDto {
  @IsEmail() email!: string;
  @MinLength(8) password!: string;
}
```

the adapter renders `forms.ts` in valibot's idiom:

```ts
import * as v from 'valibot';

export const CreateBodySchema = v.object({
  email: v.pipe(v.string(), v.email()),
  password: v.pipe(v.string(), v.minLength(8)),
});
export type CreateBody = v.InferOutput<typeof CreateBodySchema>;
```

## How it fits

The codegen builds **one** neutral schema IR from your DTOs and contracts. A validation
adapter renders that IR into a concrete library's source:

- **zod** — [`@dudousxd/nestjs-codegen-zod`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-zod) (`validation: zodAdapter`)
- **valibot** — this package (`validation: valibotAdapter`)
- **arktype** — [`@dudousxd/nestjs-codegen-arktype`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-arktype) (`validation: arktypeAdapter`)

Pick exactly one — it decides which library your generated `forms.ts` imports and
validates with.

## Documentation

- [Pluggable Validation docs](https://github.com/DavideCarvalho/nestjs-codegen/blob/main/apps/docs/content/docs/validation.mdx)
- [Repository](https://github.com/DavideCarvalho/nestjs-codegen)

## License

MIT
