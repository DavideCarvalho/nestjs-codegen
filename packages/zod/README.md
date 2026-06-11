# @dudousxd/nestjs-codegen-zod

> Zod validation adapter for [`@dudousxd/nestjs-codegen`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen).

![npm](https://img.shields.io/npm/v/@dudousxd/nestjs-codegen-zod)

`nestjs-codegen` translates your `@Body()`/`@Query()` DTOs and `defineContract` schemas
into one neutral schema IR (`SchemaNode`), then renders that IR with a **validation
adapter**. This package is the **zod** adapter: it renders the IR into zod source in the
generated `forms.ts`.

zod is the default validation adapter — reach for this package when you want to pin the
adapter explicitly, or when a future core release no longer bundles it by default.

## Install

```bash
pnpm add -D @dudousxd/nestjs-codegen-zod
```

`zod` itself is the runtime dependency your generated `forms.ts` imports from
(`import { z } from 'zod'`), so install it in your app too:

```bash
pnpm add zod
```

## Setup

zod is used by default. To pin the adapter explicitly, pass `zodAdapter` to the codegen
config:

```ts
import { defineConfig } from '@dudousxd/nestjs-codegen';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';

export default defineConfig({
  validation: zodAdapter,
});
```

Given a DTO like:

```ts
class CreateUserDto {
  @IsEmail() email!: string;
  @MinLength(8) password!: string;
}
```

the adapter renders `forms.ts` in zod's idiom:

```ts
import { z } from 'zod';

export const CreateBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type CreateBody = z.infer<typeof CreateBodySchema>;
```

## How it fits

The codegen builds **one** neutral schema IR from your DTOs and contracts. A validation
adapter renders that IR into a concrete library's source:

- **zod** — this package, the default (`validation: 'zod'`)
- **valibot** — [`@dudousxd/nestjs-codegen-valibot`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-valibot) (`validation: valibotAdapter`)
- **arktype** — [`@dudousxd/nestjs-codegen-arktype`](https://www.npmjs.com/package/@dudousxd/nestjs-codegen-arktype) (`validation: arktypeAdapter`)

Pick exactly one — it decides which library your generated `forms.ts` imports and
validates with.

## Documentation

- [Pluggable Validation docs](https://github.com/DavideCarvalho/nestjs-codegen/blob/main/apps/docs/content/docs/validation.mdx)
- [Repository](https://github.com/DavideCarvalho/nestjs-codegen)

## License

MIT
