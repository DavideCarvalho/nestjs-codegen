import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Order matters: the more specific subpath alias must come before the bare package
    // (Vite does prefix replacement, so the bare alias would otherwise swallow subpaths).
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**'],
      exclude: ['packages/*/src/**/*.d.ts'],
    },
  },
});
