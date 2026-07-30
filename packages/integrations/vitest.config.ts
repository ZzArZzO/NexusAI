import { nodeVitestConfig } from '@nexusai/config/vitest/node'

export default nodeVitestConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
  },
})
