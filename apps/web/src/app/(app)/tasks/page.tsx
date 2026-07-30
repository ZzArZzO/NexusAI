import { prisma } from '@nexusai/db'
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, cn } from '@nexusai/ui'
import { formatDistanceToNowStrict } from 'date-fns'
import { ListChecksIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { serverNow } from '@/lib/now'
import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Tasks' }

/**
 * The task board.
 *
 * Columns are the workflow, not a preference: `blocked` sits second rather than
 * at the end, because a blocked task is the thing most likely to need a human and
 * the least likely to be noticed at the far right of a board.
 *
 * `done` and `cancelled` are deliberately absent. This board answers "what is
 * happening", and a column of finished work crowds out the answer.
 */
const COLUMNS = [
  { status: 'in_progress', label: 'In progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'in_review', label: 'In review' },
  { status: 'todo', label: 'To do' },
  { status: 'backlog', label: 'Backlog' },
] as const

const PRIORITY_TONE: Record<string, 'default' | 'warning' | 'danger'> = {
  low: 'default',
  medium: 'default',
  high: 'warning',
  urgent: 'danger',
}

export default async function TasksPage() {
  const { workspace } = await requireSession()

  const tasks = await prisma.task.findMany({
    where: { workspaceId: workspace.id, status: { notIn: ['done', 'cancelled'] } },
    orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    include: {
      department: { select: { key: true, displayName: true } },
      // `dependsOn` holds the edges where *this* task is the one waiting; each
      // edge's `blockedBy` is the task it waits for.
      dependsOn: {
        select: { blockedBy: { select: { id: true, title: true, status: true } } },
      },
    },
  })

  const completedThisWeek = await prisma.task.count({
    where: {
      workspaceId: workspace.id,
      status: 'done',
      updatedAt: { gte: new Date(serverNow() - 7 * 24 * 60 * 60 * 1000) },
    },
  })

  const now = serverNow()

  return (
    <div className="flex w-full flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Everything the company is holding. {tasks.length} open
          {completedThisWeek > 0 ? `, ${completedThisWeek} finished this week` : ''}.
        </p>
      </header>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-border">
          <EmptyState
            icon={ListChecksIcon}
            title="Nothing open"
            description="Departments create tasks when work needs doing later or by someone else. An empty board means nothing is waiting — or that nobody has been asked yet."
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {COLUMNS.map((column) => {
            const inColumn = tasks.filter((task) => task.status === column.status)

            return (
              <Card key={column.status} className="min-w-0">
                <CardHeader className="flex-row items-baseline justify-between gap-2 pb-3">
                  <CardTitle className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
                    {column.label}
                  </CardTitle>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {inColumn.length}
                  </span>
                </CardHeader>

                <CardContent className="flex flex-col gap-2 pt-0">
                  {inColumn.length === 0 ? (
                    <p className="py-2 text-xs text-muted-foreground">Empty</p>
                  ) : (
                    inColumn.map((task) => {
                      const overdue = task.dueAt !== null && task.dueAt.getTime() < now
                      const blockers = task.dependsOn.filter(
                        (edge) => edge.blockedBy.status !== 'done',
                      )

                      return (
                        <article
                          key={task.id}
                          className={cn(
                            'flex flex-col gap-1.5 rounded-lg border border-border bg-card/60 p-3',
                            // A left stripe, so severity reads before the words do.
                            overdue && 'border-l-2 border-l-destructive',
                            task.status === 'blocked' && 'border-l-2 border-l-warning',
                          )}
                        >
                          <p className="text-sm leading-snug">{task.title}</p>

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {task.department ? <span>{task.department.displayName}</span> : null}
                            {task.dueAt ? (
                              <span className={overdue ? 'text-destructive' : undefined}>
                                {overdue ? 'overdue ' : 'due in '}
                                {formatDistanceToNowStrict(task.dueAt)}
                              </span>
                            ) : null}
                            {task.priority === 'high' || task.priority === 'urgent' ? (
                              <Badge variant={PRIORITY_TONE[task.priority] ?? 'default'}>
                                {task.priority}
                              </Badge>
                            ) : null}
                          </div>

                          {blockers.length > 0 ? (
                            // Naming the blocker is the difference between a status
                            // and something the operator can act on.
                            <p className="text-xs text-warning">
                              waiting on: {blockers.map((edge) => edge.blockedBy.title).join(', ')}
                            </p>
                          ) : null}

                          {task.runId ? (
                            <Link
                              href={`/runs/${task.runId}`}
                              className="font-mono text-xs text-muted-foreground hover:underline"
                            >
                              created by a run →
                            </Link>
                          ) : null}
                        </article>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
