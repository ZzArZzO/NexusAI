import { defineConfig, devices } from '@playwright/test'

import { STORAGE_STATE } from './e2e/constants'

const PORT = 3100
const BASE_URL = process.env['E2E_BASE_URL'] ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',

  /**
   * Serial, deliberately.
   *
   * Every test runs against one workspace in one database, and several of them
   * mutate state that is global to it — the automation pause is a single row,
   * and signing out revokes a session the whole project shares. Run in parallel
   * they interfere, producing failures that move between runs and look like
   * product bugs.
   *
   * The honest options were per-test workspace isolation or serial execution.
   * At this suite size serial costs about twenty seconds and buys certainty;
   * isolation is worth revisiting when the suite is large enough to care.
   */
  fullyParallel: false,
  workers: 1,

  // A `.only` left in a test file must never silently shrink the CI suite.
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /**
   * Order matters, and the reason is not obvious.
   *
   * `auth.spec.ts` includes a sign-out round trip, and signing out revokes the
   * session server-side — the same session `auth.setup.ts` captured into the
   * shared storage state. Running it before the authenticated project logs that
   * project out before it starts.
   *
   * With one worker, projects run in declaration order, so the anonymous suite
   * goes last and its revocation harms nothing.
   */
  projects: [
    // Signs in once and writes the storage state the authenticated project reuses.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'authenticated',
      testIgnore: [/auth\.spec\.ts/, /auth\.setup\.ts/],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },

    // Redirects, closed registration, rejected credentials, sign-out. These must
    // NOT carry a session, which is why they are a separate project rather than
    // a describe block.
    {
      name: 'anonymous',
      testMatch: /auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

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
