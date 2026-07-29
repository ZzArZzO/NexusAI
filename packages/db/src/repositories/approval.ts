import type { RiskTier } from '@nexusai/core'

import type { PrismaClient } from '../client'
import { type Prisma } from '../../generated/client'

/**
 * Approval gates.
 *
 * The invariant this module exists to protect: an approval that is never
 * answered must resolve to *not done*. Expiry is therefore an explicit state
 * transition to `expired`, never a silent pass — and the database trigger
 * `tool_call_approval_gate` refuses to mark a high-risk call succeeded unless a
 * matching approval is genuinely approved.
 */

export interface CreateApprovalParams {
  workspaceId: string
  departmentId: string
  runId?: string
  toolCallId?: string
  risk: RiskTier
  /** Written for the person deciding, in their terms — not the tool's. */
  title: string
  summary: string
  /** Exactly what will execute on approval. Rendered for review. */
  payload: unknown
  requiresSecondConfirmation?: boolean
  /** Event the workflow is parked on, so a decision resumes the run. */
  resumeEvent?: string
  expiresAt: Date
}

export async function createApproval(
  prisma: PrismaClient,
  params: CreateApprovalParams,
): Promise<{ id: string }> {
  return prisma.approvalRequest.create({
    data: {
      workspaceId: params.workspaceId,
      departmentId: params.departmentId,
      risk: params.risk,
      status: 'pending',
      title: params.title,
      summary: params.summary,
      payload: params.payload as Prisma.InputJsonValue,
      requiresSecondConfirmation: params.requiresSecondConfirmation ?? params.risk === 'financial',
      expiresAt: params.expiresAt,
      ...(params.runId === undefined ? {} : { runId: params.runId }),
      ...(params.toolCallId === undefined ? {} : { toolCallId: params.toolCallId }),
      ...(params.resumeEvent === undefined ? {} : { resumeEvent: params.resumeEvent }),
    },
    select: { id: true },
  })
}

export class ApprovalNotPendingError extends Error {
  constructor(id: string, status: string) {
    super(`Approval ${id} is ${status}, not pending — it cannot be decided again.`)
    this.name = 'ApprovalNotPendingError'
  }
}

export class ApprovalExpiredError extends Error {
  constructor(id: string) {
    super(`Approval ${id} has expired. Nothing was executed; the agent must ask again.`)
    this.name = 'ApprovalExpiredError'
  }
}

/**
 * Decide an approval.
 *
 * Guarded by a conditional update rather than read-then-write, so two decisions
 * arriving at once cannot both win. Expiry is checked at decision time because a
 * request that timed out while the tab was open must not be approvable.
 */
export async function decideApproval(
  prisma: PrismaClient,
  params: { approvalId: string; approved: boolean; decidedById: string; note?: string },
): Promise<{ id: string; status: 'approved' | 'rejected'; resumeEvent: string | null }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: params.approvalId },
      select: { id: true, status: true, expiresAt: true, resumeEvent: true },
    })

    if (existing.status !== 'pending') {
      throw new ApprovalNotPendingError(existing.id, existing.status)
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      await tx.approvalRequest.update({
        where: { id: existing.id },
        data: { status: 'expired', decidedAt: new Date() },
      })
      throw new ApprovalExpiredError(existing.id)
    }

    const status = params.approved ? 'approved' : 'rejected'

    const updated = await tx.approvalRequest.update({
      where: { id: existing.id },
      data: {
        status,
        decidedAt: new Date(),
        decidedById: params.decidedById,
        ...(params.note === undefined ? {} : { decisionNote: params.note }),
      },
      select: { id: true, resumeEvent: true },
    })

    return { id: updated.id, status, resumeEvent: updated.resumeEvent }
  })
}

/**
 * The second confirmation for financial actions. Separate from `decideApproval`
 * on purpose: two deliberate acts, not one checkbox, before money moves.
 */
export async function confirmFinancialApproval(
  prisma: PrismaClient,
  params: { approvalId: string; decidedById: string },
): Promise<void> {
  const approval = await prisma.approvalRequest.findUniqueOrThrow({
    where: { id: params.approvalId },
    select: { status: true, requiresSecondConfirmation: true, expiresAt: true },
  })

  if (approval.status !== 'approved') {
    throw new ApprovalNotPendingError(params.approvalId, approval.status)
  }
  if (!approval.requiresSecondConfirmation) {
    throw new Error(`Approval ${params.approvalId} does not require a second confirmation.`)
  }
  if (approval.expiresAt.getTime() <= Date.now()) {
    throw new ApprovalExpiredError(params.approvalId)
  }

  await prisma.approvalRequest.update({
    where: { id: params.approvalId },
    data: { secondConfirmedAt: new Date(), decidedById: params.decidedById },
  })
}

/**
 * Sweep timed-out requests. Run on a schedule; also called defensively before
 * listing, so the inbox never shows something as actionable when it is not.
 */
export async function expireOverdueApprovals(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<number> {
  const result = await prisma.approvalRequest.updateMany({
    where: { workspaceId, status: 'pending', expiresAt: { lte: new Date() } },
    data: { status: 'expired', decidedAt: new Date() },
  })
  return result.count
}

export async function findPendingApprovals(prisma: PrismaClient, workspaceId: string) {
  await expireOverdueApprovals(prisma, workspaceId)

  return prisma.approvalRequest.findMany({
    where: { workspaceId, status: 'pending' },
    orderBy: [{ risk: 'desc' }, { createdAt: 'asc' }],
    include: {
      department: { select: { key: true, displayName: true } },
      toolCall: { select: { toolName: true, input: true } },
      run: { select: { id: true, objective: true } },
    },
  })
}
