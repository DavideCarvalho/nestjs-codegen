import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace core to its source so tests run without a build step.
      '@dudousxd/nestjs-codegen': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
    },
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
