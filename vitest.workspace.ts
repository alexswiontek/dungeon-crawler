import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/domain/vitest.config.ts',
      'packages/protocol/vitest.config.ts',
      'packages/shared/vitest.config.ts',
      'apps/api/vitest.config.ts',
      'apps/ui/vitest.config.ts',
    ],
  },
});
