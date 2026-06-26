---
name: codegen-setup
description: >-
  Set up @dudousxd/nestjs-codegen in a NestJS app. Wire NestjsCodegenModule.forRoot from
  @dudousxd/nestjs-codegen/nest with contracts.glob + codegen.outDir + a validation ADAPTER
  INSTANCE (zodAdapter from @dudousxd/nestjs-codegen-zod, or valibotAdapter/arktypeAdapter).
  Author one defineConfig nestjs-codegen.config.ts as the single source of truth and import it into
  forRoot(); run the nestjs-codegen codegen / init / doctor CLI as a CI drift gate. Covers the
  boot-time watcher (skipped when NODE_ENV=production), the enabled/cwd module fields, and why a
  bare validation:'zod' string throws ConfigError. Use for install, wiring, config, CI generation.
metadata:
  type: core
  library: "@dudousxd/nestjs-codegen"
  library_version: 0.8.0
  framework: nestjs
---

# nestjs-codegen setup

`@dudousxd/nestjs-codegen` discovers your NestJS controllers/contracts/DTOs and emits a typed
client (`routes.ts`, `api.ts`, `forms.ts`) into an output dir. In dev the `NestjsCodegenModule`
runs a watcher with your app; in CI the `nestjs-codegen` CLI does a one-shot, watch-free run.

## Setup

Install the codegen, the runtime the generated client imports from, and a validation adapter:

```bash
pnpm add -D @dudousxd/nestjs-codegen @dudousxd/nestjs-codegen-zod
pnpm add @dudousxd/nestjs-client
```

Author one config file with `defineConfig` — this is the single source of truth the CLI loads and
the module reuses:

```ts title="nestjs-codegen.config.ts"
import { defineConfig } from '@dudousxd/nestjs-codegen';
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';

export default defineConfig({
  contracts: { glob: 'src/**/*.controller.ts' }, // controllers to scan for routes + contracts
  codegen: { outDir: 'src/generated' },           // where routes.ts / api.ts / forms.ts land
  validation: zodAdapter,                          // an ADAPTER INSTANCE, not the string 'zod'
});
```

Wire the module into your root module and import that config so dev + CI never drift:

```ts title="src/app.module.ts"
import { Module } from '@nestjs/common';
import { NestjsCodegenModule } from '@dudousxd/nestjs-codegen/nest';
import codegenConfig from '../nestjs-codegen.config';

@Module({
  imports: [NestjsCodegenModule.forRoot(codegenConfig)],
})
export class AppModule {}
```

Run the app as usual (`nest start --watch`): the watcher does an initial generate, then regenerates
as controllers/DTOs change. `@nestjs/common` is an optional peer — your Nest app already has it.

## Core patterns

### 1. forRoot() options ARE the config (plus two module-only fields)

`CodegenModuleOptions` is `UserConfig` plus `enabled` and `cwd`. You can inline the options instead
of importing a file, but a shared `defineConfig` file keeps the CLI in sync:

```ts
NestjsCodegenModule.forRoot({
  contracts: { glob: 'src/**/*.controller.ts' },
  codegen: { outDir: 'src/generated' },
  validation: zodAdapter,
  enabled: true,           // module-only: force the watcher on (see pattern 3)
  cwd: process.cwd(),      // module-only: project root for glob/outDir resolution
});
```

Source: `packages/core/src/nest/module.ts` (`CodegenModuleOptions`), `packages/core/src/config/types.ts`.

### 2. The CLI is your CI drift gate

The `nestjs-codegen` bin reads `nestjs-codegen.config.ts`. In CI, regenerate and fail on any diff so
a stale committed client can never ship:

```bash
npx nestjs-codegen codegen           # one-shot generate
npx nestjs-codegen codegen --watch   # same watcher, standalone
npx nestjs-codegen init              # scaffold a starter config
npx nestjs-codegen doctor            # diagnose missing config / unscanned controllers / drift
git diff --exit-code src/generated   # non-zero (fails CI) if the client is stale
```

Source: `apps/docs/content/docs/cli.mdx`, `packages/core/bin/nestjs-codegen.js`.

### 3. The watcher is a dev/CI concern — off in production by default

`shouldRun` returns `false` when `process.env.NODE_ENV === 'production'` unless you set `enabled`
explicitly. Codegen is a build step, not a runtime dependency, so leave it default and let prod skip
it; only set `enabled: false` to turn it off everywhere or `enabled: true` to force it.

Source: `packages/core/src/nest/module.ts` (`shouldRun`).

## Common mistakes

### Passing the validation library as a string

```ts
// ❌ Wrong — throws ConfigError at config-resolve time
defineConfig({ validation: 'zod' });
```

```ts
// ✅ Correct — import and pass the adapter instance
import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
defineConfig({ validation: zodAdapter });
```

No adapter is bundled in core; `resolveAdapter` throws a `ConfigError` for any string and tells you
to install the package and pass the instance. (Some older docs show `validation: 'zod'` — the source
is authoritative.) For valibot/arktype, import `valibotAdapter` / `arktypeAdapter` from their
packages.
Source: `packages/core/src/adapters/registry.ts` (`resolveAdapter`).

### Maintaining a second, divergent config for the CLI

```ts
// ❌ Wrong — forRoot() inlines one set of options, the CLI reads a different file → drift
NestjsCodegenModule.forRoot({ contracts: { glob: 'src/**/*.controller.ts' }, codegen: { outDir: 'gen' }, validation: zodAdapter });
// nestjs-codegen.config.ts says outDir: 'src/generated' → CI generates to a different place
```

```ts
// ✅ Correct — one defineConfig file, imported into forRoot()
import codegenConfig from '../nestjs-codegen.config';
NestjsCodegenModule.forRoot(codegenConfig);
```

The module (dev) and the CLI (CI) must resolve the same options or the CI drift check compares
against artifacts the dev watcher never wrote.
Source: `apps/docs/content/docs/getting-started.mdx` ("single source of truth").

### Expecting the watcher to run in your production container

```ts
// ❌ Wrong — assuming forRoot() regenerates the client in prod
NestjsCodegenModule.forRoot(codegenConfig); // does nothing when NODE_ENV=production
```

```ts
// ✅ Correct — generate in CI before deploy; commit the artifacts
// CI step:  npx nestjs-codegen codegen && git diff --exit-code src/generated
NestjsCodegenModule.forRoot(codegenConfig); // dev-only watcher; prod ships committed files
```

The boot-time watcher is intentionally skipped in production; the generated files are meant to be
generated in CI and committed, not produced at runtime.
Source: `packages/core/src/nest/module.ts` (`onApplicationBootstrap` guards on `shouldRun`).
