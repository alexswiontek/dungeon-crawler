import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@dungeon-crawler/domain': path.resolve(
        import.meta.dirname,
        '../domain/src/index.ts',
      ),
    },
  },
  test: {
    name: 'protocol',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
