import type { DepartmentId } from '@nexusai/core'

import type { PrismaClient } from '../client'
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
