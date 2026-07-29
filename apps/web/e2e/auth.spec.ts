import { expect, test } from '@playwright/test'

/**
 * Authentication.
 *
 * These run against a database that already has an operator, which is the
 * steady state — the first-run signup path is exercised once, by hand, and then
 * closes permanently by design.
 */
test.describe('authentication', () => {
  test('an anonymous visitor is redirected to sign in', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('the requested path is preserved through the redirect', async ({ page }) => {
    await page.goto('/departments/ceo')

    await expect(page).toHaveURL(/next=%2Fdepartments%2Fceo/)
  })

  test('registration is closed once an operator exists', async ({ page }) => {
    await page.goto('/sign-up')

    await expect(page.getByRole('heading', { name: 'Registration is closed' })).toBeVisible()
    await expect(page.getByLabel('Password')).toHaveCount(0)
  })

  test('wrong credentials are rejected with a readable message', async ({ page }) => {
    await page.goto('/sign-in')

    await page.getByLabel('Email').fill('operator@nexus.local')
    await page.getByLabel('Password').fill('definitely-the-wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toBeVisible()
    // Still on the sign-in page — a failed attempt must not navigate.
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('the sign-up API refuses a second account', async ({ request }) => {
    const response = await request.post('/api/auth/sign-up/email', {
      data: {
        email: 'intruder@nexus.local',
        password: 'a-perfectly-long-password',
        name: 'Intruder',
      },
    })

    // This is the entire access-control story for a locally hosted deployment:
    // anything that can reach the port must not be able to create an account.
    expect(response.status()).toBe(403)
  })

  test('the health endpoint stays public', async ({ request }) => {
    const response = await request.get('/api/health')

    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok' })
  })
})
