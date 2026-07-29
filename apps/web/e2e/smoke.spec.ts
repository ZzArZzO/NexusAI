import { expect, test } from '@playwright/test'

test.describe('foundation smoke', () => {
  test('renders the department overview', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'NexusAI', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'CEO' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible()
  })

  test('theme toggle cycles the document class', async ({ page }) => {
    await page.goto('/')

    const toggle = page.getByRole('button', { name: /^Theme:/ })
    await expect(toggle).toBeVisible()

    const before = await page.locator('html').getAttribute('class')
    await toggle.click()
    await expect(page.locator('html')).not.toHaveClass(before ?? '')
  })
})
