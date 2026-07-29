import { hasModelProviders } from '@nexusai/core/env/server'
import { prisma, runs as runRepo, tasks as taskRepo, workspaces } from '@nexusai/db'
import { Badge, buttonVariants, EmptyState, SkeletonText } from '@nexusai/ui'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  BrainIcon,
  CpuIcon,
  DatabaseIcon,
  InboxIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import {
  ActivityFeed,
  HealthRow,
  Metric,
  Panel,
  TaskList,
  type ActivityRow,
  type TaskRow,
} from '@/components/dashboard/panels'
import { serverDate, serverNow } from '@/lib/now'
import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Dashboard' }

const DAY_MS = 24 * 60 * 60 * 1000

export default async function DashboardPage() {
  const { workspace, user } = await requireSession()

  // One clock reading for the whole page, so "overdue" is consistent across panels.
  const now = serverNow()

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[0.65rem] tracking-[0.16em] text-muted-foreground uppercase">
            {new Intl.DateTimeFormat('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: workspace.timezone,
            }).format(serverDate())}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            Good to see you, {user.name.split(' ')[0]}
          </h1>
        </div>

        <Link href="/departments/ceo" className={buttonVariants()}>
          Talk to the CEO
        </Link>
      </header>

      {/* Each panel streams independently: the shell paints immediately and
          slower queries fill in, rather than one slow count holding the page. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<PanelSkeleton title="Company health" />}>
          <CompanyHealth workspaceId={workspace.id} currency={workspace.currency} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton title="Today" />}>
          <Agenda workspaceId={workspace.id} now={now} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton title="Waiting on you" />}>
          <Approvals workspaceId={workspace.id} />
        </Suspense>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<PanelSkeleton title="AI activity" />}>
          <Activity workspaceId={workspace.id} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton title="Active tasks" />}>
          <ActiveTasks workspaceId={workspace.id} now={now} />
        </Suspense>

        <Suspense fallback={<PanelSkeleton title="System health" />}>
          <SystemHealth workspaceId={workspace.id} />
        </Suspense>
      </div>
    </div>
  )
}

function PanelSkeleton({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <SkeletonText lines={4} />
    </Panel>
  )
}

async function CompanyHealth({ workspaceId, currency }: { workspaceId: string; currency: string }) {
  const [goals, kpis, taskCounts] = await Promise.all([
    prisma.goal.count({ where: { workspaceId, status: 'active' } }),
    prisma.kpi.findMany({
      where: { workspaceId },
      include: { snapshots: { orderBy: { observedAt: 'desc' }, take: 1 } },
    }),
    taskRepo.countByStatus(prisma, workspaceId),
  ])

  const revenue = kpis.find((k) => k.key.endsWith('revenue'))
  const latest = revenue?.snapshots[0]

  const done = taskCounts.done ?? 0
  const open = (taskCounts.todo ?? 0) + (taskCounts.in_progress ?? 0) + (taskCounts.blocked ?? 0)

  return (
    <Panel
      title="Company health"
      action={
        <Link href="/goals" className="text-xs text-muted-foreground hover:underline">
          Goals
        </Link>
      }
    >
      <div className="grid grid-cols-3 gap-4">
        <Metric
          label={revenue?.unit === 'EUR' ? `Revenue (${currency})` : 'Revenue'}
          value={latest ? Number(latest.value).toLocaleString('en-GB') : '—'}
          hint={
            revenue ? `target ${Number(revenue.target ?? 0).toLocaleString('en-GB')}` : undefined
          }
          tone={latest && Number(latest.value) > 0 ? 'good' : 'neutral'}
        />
        <Metric label="Active goals" value={String(goals)} />
        <Metric label="Open tasks" value={String(open)} hint={`${done} done`} />
      </div>
    </Panel>
  )
}

async function Agenda({ workspaceId, now }: { workspaceId: string; now: number }) {
  const endOfDay = serverDate()
  endOfDay.setHours(23, 59, 59, 999)

  const due = await taskRepo.findAgenda(prisma, { workspaceId, before: endOfDay })

  const rows: TaskRow[] = due.slice(0, 6).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    departmentName: task.department?.displayName ?? null,
  }))

  return (
    <Panel title="Today">
      <TaskList
        tasks={rows}
        now={now}
        emptyHint="Nothing is due today. The CEO sets due dates when it delegates work."
      />
    </Panel>
  )
}

async function Approvals({ workspaceId }: { workspaceId: string }) {
  const pending = await prisma.approvalRequest.findMany({
    where: { workspaceId, status: 'pending' },
    orderBy: [{ risk: 'desc' }, { createdAt: 'asc' }],
    take: 5,
    include: { department: { select: { displayName: true } } },
  })

  return (
    <Panel
      title="Waiting on you"
      action={
        pending.length > 0 ? (
          <Link href="/approvals" className="text-xs text-muted-foreground hover:underline">
            All
          </Link>
        ) : null
      }
    >
      {pending.length === 0 ? (
        <EmptyState
          icon={ShieldCheckIcon}
          title="Nothing to approve"
          description="Anything that would leave the system or spend money stops here first."
        />
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {pending.map((approval) => (
            <li key={approval.id} className="flex items-start gap-3 px-2 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link href="/approvals" className="truncate text-sm hover:underline">
                  {approval.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {approval.department.displayName} · expires in{' '}
                  {formatDistanceToNowStrict(approval.expiresAt)}
                </span>
              </div>
              <Badge variant={approval.risk === 'financial' ? 'danger' : 'warning'}>
                {approval.risk}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

async function Activity({ workspaceId }: { workspaceId: string }) {
  const recent = await runRepo.findRecentRuns(prisma, { workspaceId, limit: 8 })

  const rows: ActivityRow[] = recent.map((run) => ({
    id: run.id,
    departmentName: run.department.displayName,
    objective: run.objective,
    outcome: run.outcome,
    status: run.status,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    steps: run._count.steps,
    toolCalls: run._count.toolCalls,
  }))

  return (
    <Panel title="AI activity" className="lg:col-span-2">
      <ActivityFeed runs={rows} />
    </Panel>
  )
}

async function ActiveTasks({ workspaceId, now }: { workspaceId: string; now: number }) {
  const actionable = await taskRepo.findActionableTasks(prisma, { workspaceId, limit: 6 })

  const rows: TaskRow[] = actionable.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    departmentName: task.department?.displayName ?? null,
  }))

  return (
    <Panel title="Ready to work">
      <TaskList
        tasks={rows}
        now={now}
        emptyHint="Tasks appear here once nothing is blocking them."
      />
    </Panel>
  )
}

async function SystemHealth({ workspaceId }: { workspaceId: string }) {
  const since = new Date(serverNow() - 30 * DAY_MS)

  const [databaseOk, memoryStats, usage, paused] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    prisma.$queryRaw<{ chunks: bigint; embedded: bigint }[]>`
      SELECT count(*) AS chunks, count(embedding) AS embedded
      FROM memory_chunk WHERE workspace_id = ${workspaceId}::uuid
    `,
    runRepo.summariseUsage(prisma, { workspaceId, since }),
    workspaces.isAutomationPaused(prisma, workspaceId),
  ])

  const chunks = Number(memoryStats[0]?.chunks ?? 0)
  const embedded = Number(memoryStats[0]?.embedded ?? 0)
  const spendMicros = usage.reduce((total, row) => total + row.costMicros, 0)
  const modelsReal = hasModelProviders()

  return (
    <Panel title="System health">
      <div className="flex flex-col">
        <HealthRow
          label="Database"
          ok={databaseOk}
          detail={databaseOk ? 'reachable' : 'down'}
          icon={DatabaseIcon}
        />
        <HealthRow
          label="Memory embedded"
          ok={chunks === 0 || embedded === chunks}
          detail={chunks === 0 ? 'empty' : `${embedded}/${chunks}`}
          icon={BrainIcon}
        />
        <HealthRow
          label="Models"
          ok
          detail={modelsReal ? 'live' : 'mock'}
          icon={modelsReal ? SparklesIcon : CpuIcon}
        />
        <HealthRow
          label="Automation"
          ok={!paused}
          detail={paused ? 'paused' : 'running'}
          icon={InboxIcon}
        />
      </div>

      <p className="mt-3 font-mono text-xs text-muted-foreground">
        ${(spendMicros / 1_000_000).toFixed(2)} spent in 30 days
      </p>
    </Panel>
  )
}
