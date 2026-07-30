import { budgetStatus, monthStart, type BudgetStatus, type DepartmentId } from '@nexusai/core'

import type { PrismaClient } from '../client'
import * as runs from './run'
import { type Prisma } from '../../generated/client'

/** Keys of the settings the runtime reads. Typo-proofing what would otherwise be strings. */
export const SETTING = {
  /** Global kill switch. Every autonomous workflow checks this before its first step. */
  automationPaused: 'automation.paused',
  /** How long an approval gate waits before expiring as not-done. */
  defaultApprovalTimeout: 'automation.default_approval_timeout',
  /** Monthly model spend ceiling in micro-dollars; runs refuse to start above it. */
  monthlyBudgetMicros: 'automation.monthly_budget_micros',
} as const

export async function findWorkspaceBySlug(prisma: PrismaClient, slug: string) {
  return prisma.workspace.findUnique({ where: { slug } })
}

/**
 * The workspace, for code paths that have no session to derive it from — webhook
 * receivers and scheduled jobs.
 *
 * Ordered by creation and taking the first, so it is deterministic rather than
 * whatever Postgres returns. This system is single-operator by design; when that
 * stops being true, every caller of this function is a place that needs a real
 * workspace identifier, and finding them is a grep rather than an audit.
 */
export async function getPrimaryWorkspace(prisma: PrismaClient) {
  return prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } })
}

export async function findDepartment(
  prisma: PrismaClient,
  params: { workspaceId: string; key: DepartmentId },
) {
  return prisma.department.findUnique({
    where: { workspaceId_key: { workspaceId: params.workspaceId, key: params.key } },
    include: { config: true },
  })
}

export async function findDepartments(prisma: PrismaClient, workspaceId: string) {
  return prisma.department.findMany({
    where: { workspaceId },
    orderBy: { key: 'asc' },
    include: { config: true },
  })
}

export async function getSetting<T>(
  prisma: PrismaClient,
  params: { workspaceId: string; key: string; fallback: T },
): Promise<T> {
  const row = await prisma.systemSetting.findUnique({
    where: { workspaceId_key: { workspaceId: params.workspaceId, key: params.key } },
    select: { value: true },
  })

  return row === null ? params.fallback : (row.value as T)
}

export async function setSetting(
  prisma: PrismaClient,
  params: { workspaceId: string; key: string; value: unknown; description?: string },
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { workspaceId_key: { workspaceId: params.workspaceId, key: params.key } },
    update: { value: params.value as Prisma.InputJsonValue },
    create: {
      workspaceId: params.workspaceId,
      key: params.key,
      value: params.value as Prisma.InputJsonValue,
      ...(params.description === undefined ? {} : { description: params.description }),
    },
  })
}

/**
 * The kill switch, read at the head of every autonomous workflow.
 *
 * Defaults to paused=false, but note the direction of the default: a missing
 * setting must not silently halt the company. Failing *open* is correct here
 * precisely because nothing dangerous happens without an approval gate anyway.
 */
export async function isAutomationPaused(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<boolean> {
  return getSetting<boolean>(prisma, {
    workspaceId,
    key: SETTING.automationPaused,
    fallback: false,
  })
}

/**
 * This month's model spend against the configured limit.
 *
 * One function, read by both the kernel (to decide whether an autonomous run may
 * start) and the dashboard (to show the operator where they are). Two
 * implementations of "are we over budget" would eventually disagree, and the
 * version the UI shows is the one the operator would trust.
 *
 * A missing limit means unlimited, and that direction of default is deliberate:
 * an absent setting must not silently stop the company, for the same reason the
 * pause switch defaults to off.
 */
export async function budget(
  prisma: PrismaClient,
  params: { workspaceId: string; now?: Date },
): Promise<BudgetStatus> {
  const now = params.now ?? new Date()

  const [limit, spent] = await Promise.all([
    getSetting<number | null>(prisma, {
      workspaceId: params.workspaceId,
      key: SETTING.monthlyBudgetMicros,
      fallback: null,
    }),
    runs.spendSince(prisma, { workspaceId: params.workspaceId, since: monthStart(now) }),
  ])

  // A malformed setting is treated as unset rather than as zero. Reading a typo in
  // a JSON column as "spend nothing" would halt the company on a bad edit.
  const limitMicros = typeof limit === 'number' && Number.isFinite(limit) ? limit : null

  return budgetStatus(spent, limitMicros)
}
