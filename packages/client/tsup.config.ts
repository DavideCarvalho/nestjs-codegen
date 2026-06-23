import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'superjson/index': 'src/superjson/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  outDir: 'dist',
  external: ['@nestjs/common', 'rxjs', 'rxjs/operators', 'reflect-metadata', 'superjson'],
});
