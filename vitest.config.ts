import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Order matters: the more specific subpath/sibling aliases must come before the
    // bare package (Vite does prefix replacement, so the bare alias would otherwise
    // swallow `@dudousxd/nestjs-codegen-zod` and friends).
    alias: [
      {
        find: '@dudousxd/nestjs-codegen/extension',
        replacement: fileURLToPath(
          new URL('./packages/core/src/extension/index.ts', import.meta.url),
        ),
      },
      {
        find: '@dudousxd/nestjs-codegen-tanstack',
        replacement: fileURLToPath(new URL('./packages/tanstack/src/index.ts', import.meta.url)),
      },
      {
        find: '@dudousxd/nestjs-codegen-zod',
        replacement: fileURLToPath(new URL('./packages/zod/src/index.ts', import.meta.url)),
      },
      {
        find: '@dudousxd/nestjs-codegen-valibot',
        replacement: fileURLToPath(new URL('./packages/valibot/src/index.ts', import.meta.url)),
      },
      {
        find: '@dudousxd/nestjs-codegen-arktype',
        replacement: fileURLToPath(new URL('./packages/arktype/src/index.ts', import.meta.url)),
      },
      {
        // Resolve the workspace core to its source so tests run without a build step.
        find: '@dudousxd/nestjs-codegen',
        replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/test/**/*.{spec,test}.ts'],
    // Discovery specs parse real TypeScript through ts-morph, and the heaviest of
    // them (the factory/mixin ones) sit near a second each on a warm machine. Under
    // the full suite's parallelism on a cold cache they crossed the 5s default and
    // failed as timeouts — a slow test reported as a broken one. The work is slow,
    // not hung, so the ceiling is what was wrong.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**'],
      exclude: ['packages/*/src/**/*.d.ts'],
    },
  },
});
