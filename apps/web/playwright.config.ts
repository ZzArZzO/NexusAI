import { defineConfig, devices } from '@playwright/test'

const PORT = 3100
const BASE_URL = process.env['E2E_BASE_URL'] ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A `.only` left in a test file must never silently shrink the CI suite.
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  // Serial in CI to keep runs deterministic; locally Playwright picks a
  // worker count from the CPU, which means omitting the key entirely.
  ...(process.env['CI'] ? { workers: 1 } : {}),
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // When E2E_BASE_URL points at an already-running deployment, Playwright must
  // not start a server of its own. The key is omitted rather than set to
  // undefined so it satisfies `exactOptionalPropertyTypes`.
  ...(process.env['E2E_BASE_URL']
    ? {}
    : {
        webServer: {
          command: `pnpm start --port ${PORT}`,
          url: BASE_URL,
          reuseExistingServer: !process.env['CI'],
          timeout: 120_000,
        },
      }),
})
