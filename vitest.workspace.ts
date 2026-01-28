import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/shared/vitest.config.ts',
  'apps/api/vitest.config.ts',
  'apps/ui/vitest.config.ts'
])
