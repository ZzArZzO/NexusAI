import { can, formatBudget, MICROS_PER_DOLLAR } from '@nexusai/core'
import { hasModelProviders } from '@nexusai/core/env/server'
import { prisma, workspaces } from '@nexusai/db'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@nexusai/ui'
import type { Metadata } from 'next'
import Link from 'next/link'

import { BudgetForm } from '@/components/settings/budget-form'
import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Settings' }

/**
 * The controls that constrain the company.
 *
 * Two of them, and both are about restraint rather than configuration: what the
 * company may spend, and whether it may act at all. Everything else about a
 * department — its charter, its tools, its models — is stored per department and
 * edited from its own console, so it does not belong on a global page.
 */
export default async function SettingsPage() {
  const { actor, workspace } = await requireSession()

  const [budget, paused] = await Promise.all([
    workspaces.budget(prisma, { workspaceId: workspace.id }),
    workspaces.isAutomationPaused(prisma, workspace.id),
  ])

  const maySet = can(actor, 'setting:update')

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          What this company may spend, and whether it may act.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            Spend
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">This month</span>
              <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
                {formatBudget(budget.spentMicros)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Limit</span>
              <span className="font-mono text-2xl leading-none font-semibold text-muted-foreground tabular-nums">
                {budget.limitMicros === null ? '—' : formatBudget(budget.limitMicros)}
              </span>
            </div>
            <Badge
              variant={
                budget.state === 'exceeded'
                  ? 'danger'
                  : budget.state === 'warning'
                    ? 'warning'
                    : 'outline'
              }
            >
              {budget.state}
            </Badge>
          </div>

          {maySet ? (
            <BudgetForm
              current={
                budget.limitMicros === null ? '' : String(budget.limitMicros / MICROS_PER_DOLLAR)
              }
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Your role can see this but not change it.
            </p>
          )}

          {!hasModelProviders() ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              No model API keys are configured, so every run is using the deterministic mock and
              nothing is being charged. The figure above is what the same work <em>would</em> have
              cost — see docs/RUNBOOK.md to go live.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            Automation
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {paused ? 'Paused — nothing autonomous will start.' : 'Running.'}
            </span>
            <Badge variant={paused ? 'warning' : 'outline'}>{paused ? 'paused' : 'active'}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            The switch is in the command palette (⌘K) so it is reachable from anywhere without
            navigating here first — which is the point of a kill switch.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Link href="/settings/integrations" className="text-sm hover:underline">
            Connect services and see what the company can do →
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
