import { nodeVitestConfig } from '@nexusai/config/vitest/node'

export default nodeVitestConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
    // Integration tests share one database, so they cannot run concurrently:
    // `resetDatabase` truncates every table.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
