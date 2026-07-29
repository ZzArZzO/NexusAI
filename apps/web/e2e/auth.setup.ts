import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { expect, test as setup } from '@playwright/test'

import { STORAGE_STATE } from './constants'

/**
 * Sign in once and reuse the session across every authenticated test.
 *
 * Signing in per test would triple the suite's runtime and test the login form
 * twenty times over — which `auth.spec.ts` already does properly, once.
 *
 * The account is created if it does not exist. That only works on a database
 * with no users, which is exactly the state a fresh test database is in;
 * afterwards registration is closed and this falls through to signing in.
 */
const EMAIL = process.env['E2E_EMAIL'] ?? 'operator@nexus.local'
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'a-long-enough-password'

setup('authenticate', async ({ page, request }) => {
  const signUp = await request.post('/api/auth/sign-up/email', {
    data: { email: EMAIL, password: PASSWORD, name: 'Operator' },
    failOnStatusCode: false,
  })

  // 403 means an operator already exists, which is the normal case.
  expect([200, 403]).toContain(signUp.status())

  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good to see you')

  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })

  expect(existsSync(STORAGE_STATE)).toBe(true)
})
