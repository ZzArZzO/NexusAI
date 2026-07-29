import { expect, test } from '@playwright/test'

/**
 * The shell and the dashboard, signed in.
 *
 * These assert what the operator can actually see and reach, not implementation
 * detail — the value of the dashboard is that six independent things are legible
 * at once, so each one is checked.
 */
test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('greets the operator and shows every panel', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Good to see you')

    for (const panel of [
      'Company health',
      'Today',
      'Waiting on you',
      'AI activity',
      'Ready to work',
      'System health',
    ]) {
      await expect(page.getByText(panel, { exact: true })).toBeVisible()
    }
  })

  test('lists all nine departments in the sidebar', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Primary' })

    for (const department of [
      'CEO',
      'Operations',
      'Research',
      'Marketing',
      'Sales',
      'Support',
      'Finance',
      'Engineering',
      'Personal Assistant',
    ]) {
      await expect(nav.getByRole('link', { name: department })).toBeVisible()
    }
  })

  test('says plainly when it is running on mock models', async ({ page }) => {
    // Without API keys the answers are deterministic fakes. Showing that is the
    // difference between "the AI is being strange" and "of course it is".
    await expect(page.getByText('Mock models')).toBeVisible()
    await expect(page.getByText('mock', { exact: true })).toBeVisible()
  })

  test('reports that nothing is waiting for approval', async ({ page }) => {
    await expect(page.getByText('Nothing to approve')).toBeVisible()
  })

  test('the command palette opens and navigates', async ({ page }) => {
    const palette = page.getByPlaceholder('Go to a department, or type a command')

    // Open via the button first. Beyond testing the button, this proves the page
    // has hydrated — the keyboard shortcut is registered in an effect, so
    // pressing it before hydration genuinely does nothing, and a test that races
    // that boundary fails intermittently for a reason that is not a bug.
    await page.getByRole('button', { name: /Search or jump to/ }).click()
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)

    // Now the shortcut, which is the primary way in.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette).toBeVisible()

    await palette.fill('finance')

    // Clicking rather than pressing Enter: which row cmdk highlights after a
    // filter is its behaviour to define, not ours to assert.
    await page.getByRole('option', { name: /Finance/ }).click()

    await expect(page).toHaveURL(/\/departments\/finance/)
  })

  test('the pause switch is reachable and reversible', async ({ page }) => {
    // Scoped to the header: the toast also says "Automation paused", and the
    // badge is the persistent state while the toast is a transient confirmation.
    const badge = page.getByRole('banner').getByText('Automation paused')

    const pause = page.getByRole('button', { name: 'Pause all automation' })
    const resume = page.getByRole('button', { name: 'Resume automation' })

    // The pause is a persisted setting, so its starting value depends on
    // whatever ran before. Normalise first, then assert the round trip —
    // otherwise this test passes or fails based on state it does not control.
    if ((await badge.count()) > 0) {
      await resume.click()
      await expect(badge).toHaveCount(0)
    }

    await pause.click()
    await expect(badge).toBeVisible()

    await resume.click()
    await expect(badge).toHaveCount(0)
  })

  // Signing out lives in auth.spec.ts, not here. It revokes the session
  // server-side, and every test in this project shares one storage state — so
  // running it here logged the others out mid-suite, producing failures that had
  // nothing to do with the code under test.
})
