import { defineConfig } from 'vitest/config'

/**
 * Shared Vitest config for packages that render React (ui, web).
 * Requires a `vitest.setup.ts` in the consuming package.
 */
export function reactVitestConfig(overrides = {}) {
  return defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
      passWithNoTests: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/index.ts', 'src/**/*.d.ts'],
      },
      ...overrides.test,
    },
    ...overrides,
  })
}

export default reactVitestConfig
