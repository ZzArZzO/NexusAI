/**
 * Plain constants, deliberately free of any Playwright import.
 *
 * `playwright.config.ts` reads this. If it read the setup file instead, loading
 * the config would execute that file's `test()` call outside a test run, which
 * Playwright rejects.
 */
export const STORAGE_STATE = 'e2e/.auth/operator.json'
