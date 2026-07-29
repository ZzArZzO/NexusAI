import { defineConfig } from 'vitest/config'

/**
 * Shared Vitest config for Node-side packages (core, db, agents, integrations, jobs).
 * Coverage thresholds match the project standard: 80% minimum.
 */
export function nodeVitestConfig(overrides = {}) {
  return defineConfig({
    test: {
      environment: 'node',
      globals: true,
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
      // Packages that are pure schema/config today gain tests as they gain logic.
      passWithNoTests: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary', 'lcov'],
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/**/*.d.ts'],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
      ...overrides.test,
    },
    ...overrides,
  })
}

export default nodeVitestConfig
