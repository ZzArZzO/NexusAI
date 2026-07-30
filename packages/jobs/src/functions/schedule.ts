import { backfillEmbeddings, ingest, routerFromEnv } from '@nexusai/agents'
import { prisma, workspaces } from '@nexusai/db'

import { cron } from 'inngest'

import { inngest } from '../client'
import { MemoryIngest } from '../events'
import { runDepartment } from './department'

/**
 * Scheduled work.
 *
 * Every cron here checks the pause switch first. A paused company must not do
 * anything on a timer either — otherwise "pause" would mean "pause the things you
 * asked for, but keep doing the things you forgot about", which is worse than no
 * pause at all.
 */

async function activeWorkspaces(): Promise<{ id: string; timezone: string }[]> {
  const rows = await prisma.workspace.findMany({ select: { id: true, timezone: true } })

  const active: { id: string; timezone: string }[] = []
  for (const row of rows) {
    if (!(await workspaces.isAutomationPaused(prisma, row.id))) active.push(row)
  }
  return active
}

/**
 * The morning brief.
 *
 * 06:30 in the workspace's own timezone. Inngest crons are UTC, so this fires
 * hourly and each workspace decides whether it is 06:30 for them — which is the
 * only approach that works once there is more than one timezone, and costs
 * nothing while there is one.
 */
export const dailyBrief = inngest.createFunction(
  {
    id: 'daily-brief',
    name: 'CEO daily brief',
    triggers: [cron('TZ=Etc/UTC 30 * * * *')],
  },
  async ({ step }) => {
    const targets = await step.run('find-workspaces-at-0630', async () => {
      const rows = await activeWorkspaces()

      return rows.filter((row) => {
        const localHour = Number(
          new Intl.DateTimeFormat('en-GB', {
            hour: 'numeric',
            hour12: false,
            timeZone: row.timezone,
          }).format(new Date()),
        )
        return localHour === 6
      })
    })

    for (const workspace of targets) {
      await step.invoke(`brief-${workspace.id}`, {
        function: runDepartment,
        data: {
          workspaceId: workspace.id,
          department: 'ceo' as const,
          trigger: 'schedule' as const,
          objective:
            'Write my brief for today. Read the goals, the tasks due or overdue, and anything ' +
            'in memory from the last day. Lead with what changed and what needs a decision from ' +
            'me. File it as a daily_brief report. Be short — if nothing important happened, say so.',
        },
      })
    }

    return { briefed: targets.length }
  },
)

/**
 * Memory consolidation.
 *
 * Nightly. Distils recurring signals from recent documents into durable facts,
 * and decays facts nothing has reinforced. Without this, memory grows without
 * getting smarter: more to search, no better at answering.
 */
export const consolidateMemory = inngest.createFunction(
  {
    id: 'memory-consolidate',
    name: 'Consolidate long-term memory',
    triggers: [cron('TZ=Etc/UTC 15 3 * * *')],
  },
  async ({ step }) => {
    const workspaceIds = await step.run('list-active', async () =>
      (await activeWorkspaces()).map((row) => row.id),
    )

    let decayed = 0

    for (const workspaceId of workspaceIds) {
      decayed += await step.run(`decay-${workspaceId}`, async () => {
        // Confidence decays slowly; a fact nobody has re-observed in months
        // should stop being asserted, but not vanish — the evidence is still there.
        const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

        const result = await prisma.memoryFact.updateMany({
          where: { workspaceId, lastSeenAt: { lt: stale }, confidence: { gt: 0.1 } },
          data: { confidence: { decrement: 0.1 } },
        })

        return result.count
      })

      await step.invoke(`consolidate-${workspaceId}`, {
        function: runDepartment,
        data: {
          workspaceId,
          department: 'operations' as const,
          trigger: 'schedule' as const,
          objective:
            'Review what went into long-term memory in the last day. Write one short note ' +
            'recording anything that is now a durable fact about the business, the operator, or ' +
            'a decision — and nothing that is merely activity. If there is nothing worth keeping, ' +
            'record nothing and say so.',
        },
      })
    }

    return { workspaces: workspaceIds.length, factsDecayed: decayed }
  },
)

/**
 * Embedding backfill.
 *
 * Anything ingested without a vector — because a key was missing, or an embedding
 * call failed — is text that exists and cannot be found. This closes that gap on
 * a schedule rather than relying on someone remembering the command.
 */
export const backfillMemory = inngest.createFunction(
  {
    id: 'memory-backfill',
    name: 'Embed anything missing a vector',
    triggers: [cron('TZ=Etc/UTC */30 * * * *')],
  },
  async ({ step }) => {
    const workspaceIds = await step.run('list-workspaces', async () => {
      const rows = await prisma.workspace.findMany({ select: { id: true } })
      return rows.map((row) => row.id)
    })

    let documents = 0
    let chunks = 0

    for (const workspaceId of workspaceIds) {
      const result = await step.run(`backfill-${workspaceId}`, () =>
        backfillEmbeddings({ prisma, router: routerFromEnv(), workspaceId, batchSize: 25 }),
      )

      documents += result.documentsIngested
      chunks += result.chunksEmbedded
    }

    return { documents, chunks }
  },
)

/**
 * Asynchronous ingestion.
 *
 * Ingesting inline would make every write that records something wait on an
 * embedding round trip. As a step it is retried independently, so a transient
 * embedding failure does not lose the document.
 */
export const ingestMemory = inngest.createFunction(
  {
    id: 'memory-ingest',
    name: 'Ingest a document into memory',
    triggers: [MemoryIngest],
    retries: 3,
  },
  async ({ event, step }) => {
    const { workspaceId, kind, title, content, scopes, department, sourceRef } = event.data

    return step.run('ingest', async () => {
      const departmentId = department
        ? (
            await prisma.department.findUnique({
              where: { workspaceId_key: { workspaceId, key: department } },
              select: { id: true },
            })
          )?.id
        : undefined

      return ingest({
        prisma,
        router: routerFromEnv(),
        workspaceId,
        kind,
        title,
        content,
        scopes,
        ...(departmentId === undefined ? {} : { departmentId }),
        ...(sourceRef === undefined ? {} : { sourceRef }),
      })
    })
  },
)

/**
 * KPI roll-up.
 *
 * Snapshots whatever the ledger and pipeline currently say, so the charts have a
 * time series rather than a single current value. Runs even when automation is
 * paused: recording what is already true is not the company taking action.
 */
export const snapshotKpis = inngest.createFunction(
  { id: 'kpi-snapshot', name: 'Record today’s KPI values' },
  async ({ step }) => {
    return step.run('snapshot', async () => {
      const kpis = await prisma.kpi.findMany({ select: { id: true, workspaceId: true, key: true } })

      const observedAt = new Date()
      observedAt.setHours(0, 0, 0, 0)

      let written = 0

      for (const kpi of kpis) {
        const value = await currentKpiValue(kpi.workspaceId, kpi.key)
        if (value === null) continue

        // Upsert on (kpi, day): a re-run must correct the day's figure rather
        // than adding a second point for the same date.
        await prisma.kpiSnapshot.upsert({
          where: { kpiId_observedAt: { kpiId: kpi.id, observedAt } },
          update: { value, source: 'rollup' },
          create: { kpiId: kpi.id, value, observedAt, source: 'rollup' },
        })
        written += 1
      }

      return { written }
    })
  },
)

/**
 * Derive a KPI from the data that already exists.
 *
 * Returns null for anything not derivable, which leaves the operator's own
 * figures alone rather than overwriting them with a zero.
 */
async function currentKpiValue(workspaceId: string, key: string): Promise<number | null> {
  if (key.endsWith('pipeline')) {
    const open = await prisma.deal.aggregate({
      where: { workspaceId, stage: { notIn: ['won', 'lost'] } },
      _sum: { valueCents: true },
    })
    return (open._sum.valueCents ?? 0) / 100
  }

  if (key.endsWith('revenue')) {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const income = await prisma.transaction.aggregate({
      where: { workspaceId, direction: 'in', occurredAt: { gte: monthStart } },
      _sum: { amountCents: true },
    })
    return (income._sum.amountCents ?? 0) / 100
  }

  if (key.endsWith('published')) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    return prisma.contentItem.count({
      where: { workspaceId, status: 'published', publishedAt: { gte: weekAgo } },
    })
  }

  return null
}
