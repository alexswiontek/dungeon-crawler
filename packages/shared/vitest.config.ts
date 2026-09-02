import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@dungeon-crawler/domain': path.resolve(
        import.meta.dirname,
        '../domain/src/index.ts',
      ),
      '@dungeon-crawler/protocol': path.resolve(
        import.meta.dirname,
        '../protocol/src/index.ts',
      ),
    },
  },
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'dist/**'],
      reportsDirectory: './coverage',
      clean: true,
    },
  },
});
