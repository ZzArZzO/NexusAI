import { prisma } from '@nexusai/db'
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@nexusai/ui'
import { format } from 'date-fns'
import { TargetIcon } from 'lucide-react'
import type { Metadata } from 'next'

import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Goals' }

export default async function GoalsPage() {
  const { workspace } = await requireSession()

  const goals = await prisma.goal.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ status: 'asc' }, { targetDate: 'asc' }],
    include: { kpis: { include: { snapshots: { orderBy: { observedAt: 'desc' }, take: 1 } } } },
  })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
        <p className="text-sm text-muted-foreground">
          What the CEO prioritises against. Work that serves no stated goal is worth questioning
          before it is done.
        </p>
      </header>

      {goals.length === 0 ? (
        <div className="rounded-xl border border-border">
          <EmptyState
            icon={TargetIcon}
            title="No goals set"
            description="Tell the CEO what you are trying to achieve and it will record them here."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => (
            <li key={goal.id}>
              <Card>
                <CardHeader className="gap-2 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{goal.title}</CardTitle>
                    <div className="flex shrink-0 gap-1.5">
                      <Badge variant="outline">{goal.horizon}</Badge>
                      {goal.ownerKey ? <Badge variant="accent">{goal.ownerKey}</Badge> : null}
                    </div>
                  </div>
                  {goal.description ? (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {goal.description}
                    </p>
                  ) : null}
                  {goal.targetDate ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      by {format(goal.targetDate, 'd MMMM yyyy')}
                    </p>
                  ) : null}
                </CardHeader>

                {goal.kpis.length > 0 ? (
                  <CardContent className="flex flex-wrap gap-6 pt-0">
                    {goal.kpis.map((kpi) => {
                      const latest = kpi.snapshots[0]
                      return (
                        <div key={kpi.id} className="flex flex-col gap-0.5">
                          <span className="text-xs text-muted-foreground">{kpi.name}</span>
                          <span className="font-mono text-lg leading-none font-semibold tracking-tight">
                            {latest ? Number(latest.value).toLocaleString('en-GB') : '—'}
                            {kpi.target ? (
                              <span className="text-xs font-normal text-muted-foreground">
                                {' '}
                                / {Number(kpi.target).toLocaleString('en-GB')}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      )
                    })}
                  </CardContent>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
