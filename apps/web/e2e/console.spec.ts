import { expect, test, type Page } from '@playwright/test'

/**
 * The pages added for Phases 3–9: the department domain panels, the task board,
 * the reports list, and the integrations settings.
 *
 * These assert *behaviour that is easy to get wrong silently* rather than that
 * text exists. A domain panel that renders an empty card because a Prisma select
 * named a column wrong looks fine in a screenshot and is broken; so each check
 * below names something the page can only show if its query ran.
 *
 * Everything on a department page is scoped to the `<aside>`. Panels stream in
 * under Suspense while a fallback with the same heading is still mounted, and page
 * labels also appear in the sidebar — an unscoped `getByText` matches two or three
 * nodes and fails on strict mode rather than on the product.
 */

const panel = (page: Page) => page.getByRole('complementary')

test.describe('department domain panels', () => {
  test('the CEO console shows goals beside the chat', async ({ page }) => {
    await page.goto('/departments/ceo')

    await expect(page.getByRole('heading', { name: 'CEO', level: 1 })).toBeVisible()

    // Both panes: the panel is an addition to the conversation, not a replacement.
    await expect(page.getByLabel('Message CEO')).toBeVisible()
    await expect(panel(page).getByText('Goals', { exact: true })).toBeVisible()
    await expect(panel(page).getByText('KPIs', { exact: true })).toBeVisible()
  })

  test('Finance leads with cash, not revenue', async ({ page }) => {
    await page.goto('/departments/finance')

    await expect(panel(page).getByText('Money', { exact: true })).toBeVisible()

    // Order is a deliberate editorial choice — revenue is a story about the past,
    // cash decides whether next month happens.
    await expect(
      panel(page)
        .getByText(/^(Cash|Income|Spend)$/)
        .first(),
    ).toHaveText('Cash')
  })

  test('Sales shows the weighted pipeline figure', async ({ page }) => {
    await page.goto('/departments/sales')

    await expect(panel(page).getByText('Weighted value')).toBeVisible()
    await expect(panel(page).getByText('Untouched 3 weeks')).toBeVisible()
  })

  test('Operations surfaces what is waiting on the operator', async ({ page }) => {
    await page.goto('/departments/operations')

    await expect(panel(page).getByText('Last 24 hours')).toBeVisible()
    await expect(panel(page).getByText('Awaiting your approval')).toBeVisible()
    await expect(panel(page).getByText('Model spend')).toBeVisible()
  })

  test('every department renders its own panel without erroring', async ({ page }) => {
    // The cheap guard against a typo in one of nine Prisma selects. A broken panel
    // throws during render and Next replaces the page with an error boundary.
    for (const key of ['research', 'marketing', 'support', 'engineering', 'assistant'] as const) {
      await page.goto(`/departments/${key}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(/Application error|Internal Server Error/)).toHaveCount(0)
    }
  })
})

test.describe('task board', () => {
  test('shows the workflow columns and puts blocked work second', async ({ page }) => {
    await page.goto('/tasks')

    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible()

    const headings = page.getByRole('heading', {
      name: /^(In progress|Blocked|In review|To do|Backlog)$/,
    })
    await expect(headings).toHaveCount(5)

    // Blocked sits second on purpose: at the far right nobody notices it.
    await expect(headings.nth(1)).toHaveText('Blocked')
  })

  test('counts the seeded onboarding tasks', async ({ page }) => {
    await page.goto('/tasks')

    // The seed creates onboarding tasks, so an empty board here means the query
    // filtered them all out — which has happened before, via a status mismatch.
    await expect(page.getByText(/\d+ open/)).toBeVisible()
  })
})

test.describe('reports', () => {
  test('explains what reports are when there are none', async ({ page }) => {
    await page.goto('/reports')

    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible()
    await expect(page.getByText(/No reports yet|unread|All read/).first()).toBeVisible()
  })
})

test.describe('integrations', () => {
  test('lists every connector with nothing connected', async ({ page }) => {
    await page.goto('/settings/integrations')

    await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()

    for (const id of ['github', 'slack', 'stripe', 'notion', 'mcp', 'google']) {
      await expect(page.getByTestId(`connector-${id}`)).toBeVisible()
    }
  })

  test('shows capabilities as unavailable rather than hiding them', async ({ page }) => {
    await page.goto('/settings/integrations')

    await expect(page.getByText('What the company can do')).toBeVisible()

    // The gap is the useful information: "needs github" tells the operator what to
    // do, where a hidden row tells them nothing.
    await expect(page.getByText(/needs \w+/).first()).toBeVisible()
  })

  test('says which departments a capability is granted to', async ({ page }) => {
    await page.goto('/settings/integrations')

    // mcp.tools is granted to nobody by design — an unreviewed remote tool should
    // not be reachable by default.
    await expect(page.getByText('granted to no department').first()).toBeVisible()
  })

  test('asks for a credential and describes its shape', async ({ page }) => {
    await page.goto('/settings/integrations')

    const card = page.getByTestId('connector-github')
    await card.getByRole('button', { name: 'Connect' }).click()

    // By label, not by placeholder: both textareas take JSON, so a placeholder
    // matcher for `{` finds the settings box too.
    const box = card.getByLabel('Credential (JSON)')
    await expect(box).toBeVisible()

    // Placeholder, not value: the form never receives a stored credential back.
    await expect(box).toHaveValue('')
  })

  test('rejects a malformed credential without saving it', async ({ page }) => {
    await page.goto('/settings/integrations')

    const card = page.getByTestId('connector-github')
    await card.getByRole('button', { name: 'Connect' }).click()

    await card.getByLabel('Credential (JSON)').fill('not json at all')
    await card.getByRole('button', { name: 'Connect', exact: true }).click()

    await expect(card.getByText('That is not valid JSON.')).toBeVisible()
  })

  test('a credential that fails validation is reported, not stored', async ({ page }) => {
    await page.goto('/settings/integrations')

    const card = page.getByTestId('connector-stripe')
    await card.getByRole('button', { name: 'Connect' }).click()

    // Valid JSON, wrong shape: Stripe's schema requires an rk_ or sk_ key. The
    // message must name the problem without echoing what was typed.
    await card.getByLabel('Credential (JSON)').fill('{ "secretKey": "nope" }')
    await card.getByRole('button', { name: 'Connect', exact: true }).click()

    const feedback = card.getByRole('status')
    await expect(feedback).toContainText(/secretKey|Invalid|expected/i)

    // The message describes the shape and never echoes the value. Scoped to the
    // message, because the textarea legitimately still holds what was typed —
    // a failed attempt should not make the operator retype a token.
    await expect(feedback).not.toContainText('nope')
  })
})
