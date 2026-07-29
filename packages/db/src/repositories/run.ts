import type { DepartmentId, RiskTier } from '@nexusai/core'

import type { PrismaClient } from '../client'
import { type Prisma } from '../../generated/client'

/**
 * Run instrumentation — the explainability chain.
 *
 * Every agent invocation writes a `run`; every loop iteration writes a
 * `run_step` recording which memory chunks it cited; every tool invocation
 * writes a `tool_call`. That chain is what turns "why did Marketing say this?"
 * into a query rather than a guess, so recording it is not optional bookkeeping
 * around the agent — it is part of the agent.
 */

export interface StartRunParams {
  workspaceId: string
  departmentId: string
  trigger: 'chat' | 'schedule' | 'event' | 'delegation' | 'manual'
  objective?: string
  conversationId?: string
  parentRunId?: string
  inngestRunId?: string
}

export async function startRun(
  prisma: PrismaClient,
  params: StartRunParams,
): Promise<{ id: string }> {
  return prisma.run.create({
    data: {
      workspaceId: params.workspaceId,
      departmentId: params.departmentId,
      trigger: params.trigger,
      status: 'running',
      ...(params.objective === undefined ? {} : { objective: params.objective }),
      ...(params.conversationId === undefined ? {} : { conversationId: params.conversationId }),
      ...(params.parentRunId === undefined ? {} : { parentRunId: params.parentRunId }),
      ...(params.inngestRunId === undefined ? {} : { inngestRunId: params.inngestRunId }),
    },
    select: { id: true },
  })
}

export interface RecordStepParams {
  runId: string
  index: number
  summary?: string
  citedChunkIds?: string[]
  model?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  durationMs?: number
}

export async function recordStep(
  prisma: PrismaClient,
  params: RecordStepParams,
): Promise<{ id: string }> {
  return prisma.runStep.create({
    data: {
      runId: params.runId,
      index: params.index,
      citedChunkIds: params.citedChunkIds ?? [],
      inputTokens: params.inputTokens ?? 0,
      outputTokens: params.outputTokens ?? 0,
      cachedTokens: params.cachedTokens ?? 0,
      ...(params.summary === undefined ? {} : { summary: params.summary }),
      ...(params.model === undefined ? {} : { model: params.model }),
      ...(params.durationMs === undefined ? {} : { durationMs: params.durationMs }),
    },
    select: { id: true },
  })
}

export interface RecordToolCallParams {
  runId: string
  runStepId?: string
  toolName: string
  risk: RiskTier
  status: 'succeeded' | 'failed' | 'awaiting_approval' | 'rejected' | 'expired'
  input: unknown
  output?: unknown
  error?: string
  durationMs?: number
}

/**
 * Note the failure modes recorded here are as important as the successes: a
 * `rejected` or `expired` row is the durable proof that an action did *not*
 * happen, which is exactly what someone auditing an autonomous system needs.
 */
export async function recordToolCall(
  prisma: PrismaClient,
  params: RecordToolCallParams,
): Promise<{ id: string }> {
  return prisma.toolCall.create({
    data: {
      runId: params.runId,
      toolName: params.toolName,
      risk: params.risk,
      status: params.status,
      input: params.input as Prisma.InputJsonValue,
      ...(params.runStepId === undefined ? {} : { runStepId: params.runStepId }),
      ...(params.output === undefined ? {} : { output: params.output as Prisma.InputJsonValue }),
      ...(params.error === undefined ? {} : { error: params.error }),
      ...(params.durationMs === undefined ? {} : { durationMs: params.durationMs }),
    },
    select: { id: true },
  })
}

export interface FinishRunParams {
  runId: string
  status: 'succeeded' | 'failed' | 'cancelled' | 'awaiting_approval'
  outcome?: string
  error?: string
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; costMicros: number }
}

export async function finishRun(prisma: PrismaClient, params: FinishRunParams): Promise<void> {
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: params.runId },
    select: { startedAt: true },
  })

  const finishedAt = new Date()

  await prisma.run.update({
    where: { id: params.runId },
    data: {
      status: params.status,
      finishedAt,
      durationMs: finishedAt.getTime() - run.startedAt.getTime(),
      ...(params.outcome === undefined ? {} : { outcome: params.outcome }),
      ...(params.error === undefined ? {} : { error: params.error }),
      ...(params.usage === undefined
        ? {}
        : {
            inputTokens: params.usage.inputTokens,
            outputTokens: params.usage.outputTokens,
            cachedTokens: params.usage.cachedTokens,
            costMicros: params.usage.costMicros,
          }),
    },
  })
}

/** The full chain for one run, ordered, for the run timeline UI. */
export async function findRunTimeline(prisma: PrismaClient, runId: string) {
  return prisma.run.findUnique({
    where: { id: runId },
    include: {
      department: { select: { key: true, displayName: true } },
      steps: {
        orderBy: { index: 'asc' },
        include: { toolCalls: { orderBy: { startedAt: 'asc' } } },
      },
      toolCalls: { orderBy: { startedAt: 'asc' } },
      childRuns: {
        select: { id: true, status: true, objective: true, department: { select: { key: true } } },
      },
    },
  })
}

/** Recent activity across all departments — the dashboard's AI activity feed. */
export async function findRecentRuns(
  prisma: PrismaClient,
  params: { workspaceId: string; limit?: number; departmentKey?: DepartmentId },
) {
  return prisma.run.findMany({
    where: {
      workspaceId: params.workspaceId,
      ...(params.departmentKey === undefined ? {} : { department: { key: params.departmentKey } }),
    },
    orderBy: { startedAt: 'desc' },
    take: params.limit ?? 20,
    select: {
      id: true,
      status: true,
      trigger: true,
      objective: true,
      outcome: true,
      startedAt: true,
      durationMs: true,
      costMicros: true,
      department: { select: { key: true, displayName: true } },
      _count: { select: { steps: true, toolCalls: true } },
    },
  })
}

/** Spend and volume over a window, for the cost panel. */
export async function summariseUsage(
  prisma: PrismaClient,
  params: { workspaceId: string; since: Date },
) {
  const grouped = await prisma.run.groupBy({
    by: ['departmentId'],
    where: { workspaceId: params.workspaceId, startedAt: { gte: params.since } },
    _sum: { costMicros: true, inputTokens: true, outputTokens: true, cachedTokens: true },
    _count: { _all: true },
  })

  return grouped.map((row) => ({
    departmentId: row.departmentId,
    runs: row._count._all,
    costMicros: row._sum.costMicros ?? 0,
    inputTokens: row._sum.inputTokens ?? 0,
    outputTokens: row._sum.outputTokens ?? 0,
    cachedTokens: row._sum.cachedTokens ?? 0,
  }))
}
