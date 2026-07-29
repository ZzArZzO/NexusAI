import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusDot,
  cn,
  type Status,
} from '@nexusai/ui'
import { formatDistanceToNowStrict } from 'date-fns'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Dashboard panels.
 *
 * These are read at a glance, not read through, so the craft here is
 * information design rather than typography: state is encoded in shape as well
 * as number, and anything needing attention is distinguishable without reading
 * a word.
 */

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

/** A single headline number with its trend and target. */
export function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string | undefined
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | undefined
}) {
  const toneClass = {
    neutral: 'text-foreground',
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-destructive',
  }[tone]

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn('font-mono text-2xl leading-none font-semibold tracking-tight', toneClass)}
      >
        {value}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

export interface TaskRow {
  id: string
  title: string
  status: string
  priority: string
  dueAt: Date | null
  departmentName: string | null
}

const PRIORITY_TONE: Record<string, 'default' | 'warning' | 'danger'> = {
  low: 'default',
  medium: 'default',
  high: 'warning',
  urgent: 'danger',
}

export function TaskList({
  tasks,
  emptyHint,
  now,
}: {
  tasks: TaskRow[]
  emptyHint: string
  /** Passed in rather than read here, so every panel agrees on what "overdue" means. */
  now: number
}) {
  if (tasks.length === 0) {
    return <EmptyState title="Nothing due" description={emptyHint} />
  }

  return (
    <ul className="-mx-2 divide-y divide-border">
      {tasks.map((task) => {
        const overdue = task.dueAt !== null && task.dueAt.getTime() < now

        return (
          <li key={task.id} className="flex items-start gap-3 px-2 py-2.5">
            <span
              className={cn(
                'mt-1.5 size-1.5 shrink-0 rounded-full',
                overdue ? 'bg-destructive' : 'bg-muted-foreground/40',
              )}
              aria-hidden
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm">{task.title}</span>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {task.departmentName ? <span>{task.departmentName}</span> : null}
                {task.dueAt ? (
                  <span className={overdue ? 'text-destructive' : undefined}>
                    {overdue ? 'overdue by ' : 'due in '}
                    {formatDistanceToNowStrict(task.dueAt)}
                  </span>
                ) : null}
              </div>
            </div>
            {task.priority !== 'medium' && task.priority !== 'low' ? (
              <Badge variant={PRIORITY_TONE[task.priority] ?? 'default'}>{task.priority}</Badge>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export interface ActivityRow {
  id: string
  departmentName: string
  objective: string | null
  outcome: string | null
  status: string
  startedAt: Date
  durationMs: number | null
  steps: number
  toolCalls: number
}

const RUN_STATUS: Record<string, Status> = {
  running: 'working',
  awaiting_approval: 'waiting',
  failed: 'failed',
  succeeded: 'idle',
  cancelled: 'idle',
}

export function ActivityFeed({ runs }: { runs: ActivityRow[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Every agent run appears here with its steps, tool calls and cost. Start a conversation with a department to see one."
      />
    )
  }

  return (
    <ul className="-mx-2 divide-y divide-border">
      {runs.map((run) => (
        <li key={run.id} className="flex items-start gap-3 px-2 py-2.5">
          <StatusDot status={RUN_STATUS[run.status] ?? 'idle'} className="mt-1.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link
              href={`/runs/${run.id}`}
              className="truncate text-sm hover:underline"
              title={run.objective ?? undefined}
            >
              {run.objective ?? run.outcome ?? 'Untitled run'}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">
              {run.departmentName} · {run.steps} steps · {run.toolCalls} tools ·{' '}
              {formatDistanceToNowStrict(run.startedAt)} ago
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function HealthRow({
  label,
  ok,
  detail,
  icon: Icon,
}: {
  label: string
  ok: boolean
  detail: string
  icon: LucideIcon
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 truncate text-sm">{label}</span>
      <span className="font-mono text-xs text-muted-foreground">{detail}</span>
      <StatusDot status={ok ? 'working' : 'failed'} />
    </div>
  )
}
