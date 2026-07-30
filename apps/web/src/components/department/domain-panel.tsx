import type { DepartmentId } from '@nexusai/core'
import { prisma } from '@nexusai/db'
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, cn } from '@nexusai/ui'
import { formatDistanceToNowStrict } from 'date-fns'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { serverNow } from '@/lib/now'

/**
 * The department's own domain, beside its chat.
 *
 * A console that is only a chat window makes the operator ask questions to find
 * out facts the system already knows. Each panel below shows the state that
 * department is responsible for — the pipeline, the ledger, the tickets — so the
 * answer is on screen before the question is typed.
 *
 * Each is an async server component fetching only what it displays. They render
 * independently under Suspense, so a slow ledger query does not hold up the chat.
 */

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-baseline justify-between gap-3 pb-3">
        <CardTitle className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
          {title}
        </CardTitle>
        {hint ? <span className="font-mono text-xs text-muted-foreground">{hint}</span> : null}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

/** A label and a figure on one line. The workhorse of every panel here. */
function Row({
  label,
  value,
  tone = 'neutral',
  href,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | undefined
  /** Undefined renders plain text — `exactOptionalPropertyTypes` needs it explicit. */
  href?: string | undefined
}) {
  const toneClass = {
    neutral: 'text-foreground',
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-destructive',
  }[tone]

  const text = <span className="min-w-0 flex-1 truncate text-sm">{label}</span>

  return (
    <div className="flex items-center gap-3 py-1.5">
      {href ? (
        <Link href={href} className="min-w-0 flex-1 truncate text-sm hover:underline">
          {label}
        </Link>
      ) : (
        text
      )}
      <span className={cn('shrink-0 font-mono text-sm tabular-nums', toneClass)}>{value}</span>
    </div>
  )
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)

/* ---------------------------------------------------------------- CEO ------ */

async function CeoPanel({ workspaceId }: { workspaceId: string }) {
  const [goals, kpis] = await Promise.all([
    prisma.goal.findMany({
      where: { workspaceId, status: 'active' },
      orderBy: { targetDate: 'asc' },
      take: 6,
      select: { id: true, title: true, horizon: true, targetDate: true },
    }),
    prisma.kpi.findMany({
      where: { workspaceId },
      orderBy: { key: 'asc' },
      take: 6,
      select: {
        key: true,
        name: true,
        unit: true,
        target: true,
        // The current value is the latest snapshot, not a column: a KPI with a
        // stored "current" that nobody updates is a number that lies quietly.
        snapshots: { orderBy: { observedAt: 'desc' }, take: 1, select: { value: true } },
      },
    }),
  ])

  return (
    <Stack>
      <Section title="Goals" hint={`${goals.length} active`}>
        {goals.length === 0 ? (
          <EmptyState
            title="No goals set"
            description="Ask the CEO to record one. Work that serves no stated goal is work nobody agreed to."
          />
        ) : (
          <div className="divide-y divide-border">
            {goals.map((goal) => (
              <Row
                key={goal.id}
                label={goal.title}
                href="/goals"
                value={goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : goal.horizon}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="KPIs">
        {kpis.length === 0 ? (
          <EmptyState title="No KPIs" description="Nothing is being measured yet." />
        ) : (
          <div className="divide-y divide-border">
            {kpis.map((kpi) => {
              const latest = kpi.snapshots[0]
              const current = latest === undefined ? null : Number(latest.value)
              const target = kpi.target === null ? null : Number(kpi.target)

              return (
                <Row
                  key={kpi.key}
                  label={kpi.name}
                  // Unmeasured says so. A dash is honest; a zero is a claim.
                  value={
                    current === null ? '—' : `${current}${target === null ? '' : ` / ${target}`}`
                  }
                  tone={
                    current === null || target === null
                      ? 'neutral'
                      : current >= target
                        ? 'good'
                        : 'warn'
                  }
                />
              )
            })}
          </div>
        )}
      </Section>
    </Stack>
  )
}

/* --------------------------------------------------------- Operations ------ */

async function OperationsPanel({ workspaceId }: { workspaceId: string }) {
  const hourAgo = new Date(serverNow() - 60 * 60 * 1000)
  const dayAgo = new Date(serverNow() - 24 * 60 * 60 * 1000)

  const [byStatus, pending, blocked, stuck] = await Promise.all([
    prisma.run.groupBy({
      by: ['status'],
      where: { workspaceId, startedAt: { gte: dayAgo } },
      _count: true,
      _sum: { costMicros: true },
    }),
    prisma.approvalRequest.count({ where: { workspaceId, status: 'pending' } }),
    prisma.task.count({ where: { workspaceId, status: 'blocked' } }),
    prisma.run.findMany({
      where: { workspaceId, status: 'running', startedAt: { lt: hourAgo } },
      select: { id: true, objective: true, startedAt: true },
      take: 5,
    }),
  ])

  const total = byStatus.reduce((sum, row) => sum + row._count, 0)
  const failed = byStatus.find((row) => row.status === 'failed')?._count ?? 0
  const spentMicros = byStatus.reduce((sum, row) => sum + (row._sum.costMicros ?? 0), 0)

  return (
    <Stack>
      <Section title="Last 24 hours">
        <div className="divide-y divide-border">
          <Row label="Runs" value={String(total)} />
          <Row label="Failed" value={String(failed)} tone={failed > 0 ? 'bad' : 'good'} />
          <Row label="Model spend" value={`$${(spentMicros / 1_000_000).toFixed(2)}`} />
          <Row
            label="Awaiting your approval"
            value={String(pending)}
            tone={pending > 0 ? 'warn' : 'neutral'}
            href={pending > 0 ? '/approvals' : undefined}
          />
          <Row
            label="Blocked tasks"
            value={String(blocked)}
            tone={blocked > 0 ? 'warn' : 'neutral'}
          />
        </div>
      </Section>

      {stuck.length > 0 ? (
        <Section title="Stuck" hint="running over an hour">
          {/* Not "in progress". Something is wedged, and nobody would otherwise notice. */}
          <div className="divide-y divide-border">
            {stuck.map((run) => (
              <Row
                key={run.id}
                label={run.objective ?? 'Untitled run'}
                href={`/runs/${run.id}`}
                value={`${formatDistanceToNowStrict(run.startedAt)} ago`}
                tone="bad"
              />
            ))}
          </div>
        </Section>
      ) : null}
    </Stack>
  )
}

/* ----------------------------------------------------------- Research ------ */

async function ResearchPanel({ workspaceId }: { workspaceId: string }) {
  const [sources, reports] = await Promise.all([
    prisma.source.findMany({
      where: { workspaceId },
      orderBy: { retrievedAt: 'desc' },
      take: 8,
      select: { id: true, url: true, title: true, retrievedAt: true },
    }),
    prisma.report.findMany({
      where: { workspaceId, kind: 'research' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, createdAt: true },
    }),
  ])

  return (
    <Stack>
      <Section title="Reports">
        {reports.length === 0 ? (
          <EmptyState
            title="No research yet"
            description="Ask Research a question that needs looking up."
          />
        ) : (
          <div className="divide-y divide-border">
            {reports.map((report) => (
              <Row
                key={report.id}
                label={report.title}
                href={`/reports/${report.id}`}
                value={report.createdAt.toISOString().slice(0, 10)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Sources" hint={`${sources.length} recorded`}>
        {sources.length === 0 ? (
          <EmptyState title="No sources" description="Every external claim should cite one." />
        ) : (
          <div className="divide-y divide-border">
            {sources.map((source) => (
              <Row
                key={source.id}
                label={source.title ?? new URL(source.url).hostname}
                value={source.retrievedAt.toISOString().slice(0, 10)}
              />
            ))}
          </div>
        )}
      </Section>
    </Stack>
  )
}

/* ---------------------------------------------------------- Marketing ------ */

const CONTENT_STAGES = ['idea', 'drafting', 'review', 'approved', 'scheduled', 'published'] as const

async function MarketingPanel({ workspaceId }: { workspaceId: string }) {
  const [byStatus, recent, slots] = await Promise.all([
    prisma.contentItem.groupBy({ by: ['status'], where: { workspaceId }, _count: true }),
    prisma.contentItem.findMany({
      where: { workspaceId, status: { notIn: ['published', 'archived'] } },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { id: true, title: true, format: true, status: true },
    }),
    prisma.scheduleSlot.findMany({
      where: { workspaceId, scheduledFor: { gte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: 5,
      select: { id: true, channel: true, scheduledFor: true, status: true },
    }),
  ])

  const count = (status: string) => byStatus.find((row) => row.status === status)?._count ?? 0

  return (
    <Stack>
      <Section title="Pipeline">
        <div className="divide-y divide-border">
          {CONTENT_STAGES.map((stage) => (
            <Row key={stage} label={stage} value={String(count(stage))} />
          ))}
        </div>
      </Section>

      <Section title="In progress">
        {recent.length === 0 ? (
          <EmptyState title="Nothing drafted" description="Ask Marketing for ideas to start." />
        ) : (
          <div className="divide-y divide-border">
            {recent.map((item) => (
              <Row key={item.id} label={item.title} value={item.format} />
            ))}
          </div>
        )}
      </Section>

      {slots.length > 0 ? (
        <Section title="Scheduled">
          <div className="divide-y divide-border">
            {slots.map((slot) => (
              <Row
                key={slot.id}
                label={slot.channel}
                value={slot.scheduledFor.toISOString().slice(0, 16).replace('T', ' ')}
                tone={slot.status === 'awaiting_approval' ? 'warn' : 'neutral'}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </Stack>
  )
}

/* -------------------------------------------------------------- Sales ------ */

async function SalesPanel({ workspaceId, currency }: { workspaceId: string; currency: string }) {
  const staleAfter = new Date(serverNow() - 21 * 24 * 60 * 60 * 1000)

  const [open, contacts, stale] = await Promise.all([
    prisma.deal.findMany({
      where: { workspaceId, stage: { notIn: ['won', 'lost'] } },
      orderBy: { valueCents: 'desc' },
      select: { id: true, title: true, stage: true, valueCents: true, probability: true },
    }),
    prisma.contact.count({ where: { workspaceId } }),
    prisma.deal.count({
      where: { workspaceId, stage: { notIn: ['won', 'lost'] }, updatedAt: { lt: staleAfter } },
    }),
  ])

  const totalCents = open.reduce((sum, deal) => sum + deal.valueCents, 0)
  const weightedCents = open.reduce(
    (sum, deal) => sum + (deal.valueCents * deal.probability) / 100,
    0,
  )

  return (
    <Stack>
      <Section title="Pipeline" hint={`${open.length} open`}>
        <div className="divide-y divide-border">
          {/* Weighted first: it is the honest number, and the raw total is what
              gets quoted when someone wants a bigger one. */}
          <Row label="Weighted value" value={money(weightedCents / 100, currency)} />
          <Row label="Total value" value={money(totalCents / 100, currency)} />
          <Row label="Contacts" value={String(contacts)} />
          <Row label="Untouched 3 weeks" value={String(stale)} tone={stale > 0 ? 'warn' : 'good'} />
        </div>
      </Section>

      <Section title="Deals">
        {open.length === 0 ? (
          <EmptyState title="No open deals" description="Nothing in the pipeline yet." />
        ) : (
          <div className="divide-y divide-border">
            {open.slice(0, 8).map((deal) => (
              <Row
                key={deal.id}
                label={`${deal.title} · ${deal.stage}`}
                value={money(deal.valueCents / 100, currency)}
              />
            ))}
          </div>
        )}
      </Section>
    </Stack>
  )
}

/* ------------------------------------------------------------ Support ------ */

async function SupportPanel({ workspaceId }: { workspaceId: string }) {
  const [byStatus, tickets, articles] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], where: { workspaceId }, _count: true }),
    prisma.ticket.findMany({
      where: { workspaceId, status: { notIn: ['resolved', 'closed'] } },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: { id: true, subject: true, status: true, priority: true },
    }),
    prisma.kbArticle.count({ where: { workspaceId } }),
  ])

  const count = (status: string) => byStatus.find((row) => row.status === status)?._count ?? 0
  const escalated = count('escalated')

  return (
    <Stack>
      <Section title="Inbox">
        <div className="divide-y divide-border">
          <Row label="Open" value={String(count('open'))} />
          <Row label="Waiting on us" value={String(count('waiting_on_us'))} />
          <Row
            label="Escalated to you"
            value={String(escalated)}
            tone={escalated > 0 ? 'bad' : 'good'}
          />
          <Row label="Knowledge base articles" value={String(articles)} />
        </div>
      </Section>

      <Section title="Tickets">
        {tickets.length === 0 ? (
          <EmptyState title="Nothing open" description="No tickets need attention." />
        ) : (
          <div className="divide-y divide-border">
            {tickets.map((ticket) => (
              <Row
                key={ticket.id}
                label={ticket.subject}
                value={ticket.status.replace(/_/g, ' ')}
                tone={ticket.status === 'escalated' ? 'bad' : 'neutral'}
              />
            ))}
          </div>
        )}
      </Section>
    </Stack>
  )
}

/* ------------------------------------------------------------ Finance ------ */

async function FinancePanel({ workspaceId, currency }: { workspaceId: string; currency: string }) {
  const since = new Date(serverNow() - 30 * 24 * 60 * 60 * 1000)

  const [allTime, window, subs, flagged] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['direction'],
      where: { workspaceId },
      _sum: { amountCents: true },
    }),
    prisma.transaction.groupBy({
      by: ['direction'],
      where: { workspaceId, occurredAt: { gte: since } },
      _sum: { amountCents: true },
    }),
    prisma.subscription.findMany({
      where: { workspaceId, cancelledAt: null },
      select: { name: true, amountCents: true, interval: true, direction: true },
    }),
    prisma.transaction.count({ where: { workspaceId, anomalyNote: { not: null } } }),
  ])

  const sum = (rows: { direction: string; _sum: { amountCents: number | null } }[], dir: string) =>
    rows.find((row) => row.direction === dir)?._sum.amountCents ?? 0

  // Cash comes from the whole ledger; income and spend from the window. A 30-day
  // view of cash is not cash.
  const cash = sum(allTime, 'in') - sum(allTime, 'out')
  const income = sum(window, 'in')
  const spend = sum(window, 'out')

  const monthlyOut = subs.reduce(
    (total, sub) =>
      total +
      (sub.direction === 'out'
        ? sub.interval === 'yearly'
          ? sub.amountCents / 12
          : sub.amountCents
        : 0),
    0,
  )

  return (
    <Stack>
      <Section title="Money" hint="last 30 days">
        <div className="divide-y divide-border">
          {/* Cash first, not revenue: revenue is a story about the past. */}
          <Row label="Cash" value={money(cash / 100, currency)} tone={cash < 0 ? 'bad' : 'good'} />
          <Row label="Income" value={money(income / 100, currency)} />
          <Row label="Spend" value={money(spend / 100, currency)} />
          <Row
            label="Net"
            value={money((income - spend) / 100, currency)}
            tone={income - spend < 0 ? 'warn' : 'good'}
          />
          <Row label="Recurring cost / month" value={money(monthlyOut / 100, currency)} />
          <Row label="Flagged" value={String(flagged)} tone={flagged > 0 ? 'warn' : 'neutral'} />
        </div>
      </Section>

      {subs.length > 0 ? (
        <Section title="Subscriptions">
          <div className="divide-y divide-border">
            {subs.map((sub) => (
              <Row
                key={sub.name}
                label={`${sub.name} · ${sub.interval}`}
                value={money(sub.amountCents / 100, currency)}
                tone={sub.direction === 'in' ? 'good' : 'neutral'}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </Stack>
  )
}

/* -------------------------------------------------------- Engineering ------ */

async function EngineeringPanel({ workspaceId }: { workspaceId: string }) {
  const [repos, incidents, reviews] = await Promise.all([
    prisma.repository.findMany({
      where: { workspaceId },
      select: { id: true, fullName: true, _count: { select: { reviews: true } } },
    }),
    prisma.incident.findMany({
      where: { workspaceId },
      orderBy: { startedAt: 'desc' },
      take: 6,
      select: { id: true, title: true, status: true, severity: true, rootCause: true },
    }),
    prisma.pullRequestReview.count({ where: { postedAt: null } }),
  ])

  const open = incidents.filter((incident) => incident.status !== 'resolved').length

  return (
    <Stack>
      <Section title="State">
        <div className="divide-y divide-border">
          <Row label="Repositories" value={String(repos.length)} />
          <Row
            label="Reviews awaiting you"
            value={String(reviews)}
            tone={reviews > 0 ? 'warn' : 'neutral'}
          />
          <Row label="Open incidents" value={String(open)} tone={open > 0 ? 'bad' : 'good'} />
        </div>
      </Section>

      {repos.length > 0 ? (
        <Section title="Repositories">
          <div className="divide-y divide-border">
            {repos.map((repo) => (
              <Row key={repo.id} label={repo.fullName} value={`${repo._count.reviews} reviews`} />
            ))}
          </div>
        </Section>
      ) : null}

      {incidents.length > 0 ? (
        <Section title="Incidents">
          <div className="divide-y divide-border">
            {incidents.map((incident) => (
              <Row
                key={incident.id}
                label={incident.title}
                // Whether the cause is known matters more than the status word.
                value={incident.rootCause === null ? 'cause unknown' : incident.status}
                tone={incident.status === 'resolved' ? 'good' : 'bad'}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </Stack>
  )
}

/* ---------------------------------------------------------- Assistant ------ */

async function AssistantPanel({ workspaceId }: { workspaceId: string }) {
  const now = new Date(serverNow())
  const soon = new Date(serverNow() + 7 * 24 * 60 * 60 * 1000)

  const [events, reminders, notes] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { workspaceId, startsAt: { gte: now, lte: soon } },
      orderBy: { startsAt: 'asc' },
      take: 8,
      select: { id: true, title: true, startsAt: true, attendees: true },
    }),
    prisma.reminder.findMany({
      where: { workspaceId, completedAt: null },
      orderBy: { dueAt: 'asc' },
      take: 6,
      select: { id: true, body: true, dueAt: true },
    }),
    prisma.note.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, kind: true },
    }),
  ])

  return (
    <Stack>
      <Section title="Next 7 days">
        {events.length === 0 ? (
          <EmptyState title="Calendar is clear" description="Nothing scheduled this week." />
        ) : (
          <div className="divide-y divide-border">
            {events.map((event) => (
              <Row
                key={event.id}
                label={event.title}
                value={event.startsAt.toISOString().slice(5, 16).replace('T', ' ')}
                tone={event.attendees.length > 0 ? 'neutral' : 'good'}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Reminders">
        {reminders.length === 0 ? (
          <EmptyState title="Nothing pending" description="No reminders set." />
        ) : (
          <div className="divide-y divide-border">
            {reminders.map((reminder) => (
              <Row
                key={reminder.id}
                label={reminder.body}
                value={formatDistanceToNowStrict(reminder.dueAt)}
                tone={reminder.dueAt.getTime() < serverNow() ? 'bad' : 'neutral'}
              />
            ))}
          </div>
        )}
      </Section>

      {notes.length > 0 ? (
        <Section title="Recent notes">
          <div className="divide-y divide-border">
            {notes.map((note) => (
              <Row key={note.id} label={note.title} value={note.kind} />
            ))}
          </div>
        </Section>
      ) : null}
    </Stack>
  )
}

/* ----------------------------------------------------------- Selector ------ */

export interface DomainPanelProps {
  department: DepartmentId
  workspaceId: string
  currency: string
}

/**
 * Dispatch by department.
 *
 * A switch rather than a lookup table of components: creating a component value
 * during render is what the React Compiler's "cannot create components during
 * render" rule exists to prevent, and returning JSX directly avoids it.
 */
export function DomainPanel({ department, workspaceId, currency }: DomainPanelProps) {
  switch (department) {
    case 'ceo':
      return <CeoPanel workspaceId={workspaceId} />
    case 'operations':
      return <OperationsPanel workspaceId={workspaceId} />
    case 'research':
      return <ResearchPanel workspaceId={workspaceId} />
    case 'marketing':
      return <MarketingPanel workspaceId={workspaceId} />
    case 'sales':
      return <SalesPanel workspaceId={workspaceId} currency={currency} />
    case 'support':
      return <SupportPanel workspaceId={workspaceId} />
    case 'finance':
      return <FinancePanel workspaceId={workspaceId} currency={currency} />
    case 'engineering':
      return <EngineeringPanel workspaceId={workspaceId} />
    case 'assistant':
      return <AssistantPanel workspaceId={workspaceId} />
  }
}

/** Shown while a panel's queries run. */
export function DomainPanelFallback() {
  return (
    <Stack>
      {[0, 1].map((index) => (
        <Card key={index} className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
              Loading
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </CardContent>
        </Card>
      ))}
    </Stack>
  )
}

/** Tool count badge for the console header. */
export function ToolBadges({ tools }: { tools: string[] }) {
  const shown = tools.slice(0, 6)
  const rest = tools.length - shown.length

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((tool) => (
        <Badge key={tool} variant="outline" className="font-mono text-[0.65rem]">
          {tool}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="outline" className="font-mono text-[0.65rem]">
          +{rest} more
        </Badge>
      ) : null}
    </div>
  )
}
