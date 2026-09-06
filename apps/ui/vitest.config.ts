import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@dungeon-crawler/domain': path.resolve(
        import.meta.dirname,
        '../../packages/domain/src',
      ),
      '@dungeon-crawler/protocol': path.resolve(
        import.meta.dirname,
        '../../packages/protocol/src',
      ),
    },
  },
  test: {
    name: 'ui',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
      ],
      reportsDirectory: './coverage',
      clean: true,
    },
  },
});
