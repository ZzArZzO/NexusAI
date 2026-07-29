import { expect, test } from '@playwright/test'

/**
 * The CEO console, end to end.
 *
 * This is Phase 1's acceptance criterion in test form: ask a question, watch the
 * agent search memory, get an answer, and follow the trail back to the exact
 * chunks it was given.
 */
test.describe('department console', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/departments/ceo')
  })

  test('shows the department, its tools and its memory scopes', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'CEO', level: 1 })).toBeVisible()
    await expect(page.getByText('memory.recall')).toBeVisible()
    await expect(page.getByText(/memory: company/)).toBeVisible()
  })

  test('answers a question by searching memory first', async ({ page }) => {
    await page.getByLabel('Message CEO').fill('What did we decide about pricing?')
    await page.getByRole('button', { name: 'Send' }).click()

    // The tool call is rendered rather than hidden: watching it search is what
    // makes the answer trustworthy rather than something to take on faith.
    await expect(page.getByText('memory.recall')).toHaveCount(2, { timeout: 30_000 })
    await expect(page.getByText(/from memory/)).toBeVisible({ timeout: 30_000 })

    await expect(page.getByText(/long-term memory/i).last()).toBeVisible({ timeout: 30_000 })
  })

  test('says plainly that it is a mock answer', async ({ page }) => {
    await page.getByLabel('Message CEO').fill('Hello there')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.getByText(/Mock model/i)).toBeVisible({ timeout: 30_000 })
  })

  test('a suggestion starts the conversation', async ({ page }) => {
    await page.getByRole('button', { name: 'What are our current goals?' }).click()

    await expect(page.getByText(/Mock model|long-term memory/i).first()).toBeVisible({
      timeout: 30_000,
    })
  })

  test('the run appears on the dashboard and links to its timeline', async ({ page }) => {
    await page.getByLabel('Message CEO').fill('What did we decide about pricing?')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText(/from memory/)).toBeVisible({ timeout: 30_000 })

    await page.goto('/')

    const runLink = page.getByRole('link', { name: /What did we decide about pricing/ }).first()
    await expect(runLink).toBeVisible()
    await runLink.click()

    await expect(page).toHaveURL(/\/runs\//)
  })
})

test.describe('run timeline', () => {
  test('traces the answer back to the memory it was given', async ({ page }) => {
    await page.goto('/departments/ceo')
    await page.getByLabel('Message CEO').fill('Remind me what we decided about pricing.')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText(/from memory/)).toBeVisible({ timeout: 30_000 })

    await page.goto('/')
    await page
      .getByRole('link', { name: /Remind me what we decided/ })
      .first()
      .click()

    await expect(page.getByRole('heading', { name: 'Steps' })).toBeVisible()
    await expect(page.getByText('Called memory.recall')).toBeVisible()

    // The whole point of the page: the exact text the step was handed.
    const chunks = page.getByText(/memory chunks given to this step/).first()
    await expect(chunks).toBeVisible()
    await chunks.click()

    await expect(page.getByText(/forty-nine euros/i).first()).toBeVisible()
  })
})

test.describe('memory browser', () => {
  test('lists documents and reports how many are embedded', async ({ page }) => {
    await page.goto('/memory')

    await expect(page.getByRole('heading', { name: 'Memory', level: 1 })).toBeVisible()
    await expect(page.getByText(/chunks · \d+ embedded/)).toBeVisible()
  })

  test('searches with the same retrieval the agents use', async ({ page }) => {
    await page.goto('/memory')

    await page.getByLabel('Search memory').fill('pricing')
    await page.getByLabel('Search memory').press('Enter')

    await expect(page).toHaveURL(/q=pricing/)
    await expect(page.getByText(/results for/)).toBeVisible()

    // Showing which signal found each hit is the honest version of a relevance
    // score — "meaning only" and "both signals" say different things about it.
    await expect(page.getByText(/both signals|meaning only|exact term only/).first()).toBeVisible()
  })
})

test.describe('approvals', () => {
  test('reports an empty inbox and explains what would land there', async ({ page }) => {
    await page.goto('/approvals')

    await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible()
    await expect(page.getByText('Nothing waiting')).toBeVisible()
    await expect(page.getByText(/leave the system or spend money/)).toBeVisible()
  })
})
