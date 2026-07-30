'use server'

import { assert } from '@nexusai/core'
import { approvals, audit, prisma } from '@nexusai/db'
import { ApprovalResponded, inngest } from '@nexusai/jobs'
import { revalidatePath } from 'next/cache'

import { requireActor } from '@/lib/session'

/**
 * Deciding an approval.
 *
 * The interesting rules are in `packages/db/src/repositories/approval.ts` — a
 * decision is a conditional update so two clicks cannot both win, and an expired
 * request is rejected at decision time rather than silently honoured. This is
 * the thin layer that checks who is asking.
 */

export interface DecisionResult {
  ok: boolean
  message: string
}

export async function decideApproval(
  approvalId: string,
  approved: boolean,
  note?: string,
): Promise<DecisionResult> {
  const { actor, workspace } = await requireActor()

  assert(actor, 'approval:decide', { workspaceId: workspace.id })

  // Cross-tenant guard: the id came from the client, so ownership is proven
  // here rather than assumed from the fact that it rendered.
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
    select: { workspaceId: true, title: true, risk: true, requiresSecondConfirmation: true },
  })

  if (approval?.workspaceId !== workspace.id) {
    return { ok: false, message: 'That approval no longer exists.' }
  }

  try {
    const result = await approvals.decideApproval(prisma, {
      approvalId,
      approved,
      decidedById: actor.id,
      ...(note === undefined ? {} : { note }),
    })

    await audit.record(prisma, {
      workspaceId: workspace.id,
      actor: { userId: actor.id },
      action: result.status,
      resource: 'approval',
      resourceId: approvalId,
      metadata: { title: approval.title },
    })

    /**
     * Un-park the workflow.
     *
     * Written to the database *first*, then announced. If the event were sent
     * before the row was committed, a workflow that resumed quickly could read a
     * still-pending approval and refuse the action the operator just allowed.
     */
    await inngest.send(
      ApprovalResponded.create({
        workspaceId: workspace.id,
        approvalId,
        approved,
        risk: approval.risk,
        secondConfirmed: false,
      }),
    )

    revalidatePath('/approvals')
    revalidatePath('/', 'layout')

    return {
      ok: true,
      message: approved ? 'Approved. The action can now run.' : 'Rejected. Nothing was executed.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not record that decision.',
    }
  }
}

/**
 * The second confirmation for money.
 *
 * Separate from approving on purpose: two deliberate acts, not one checkbox.
 * `approval:confirm` is owner-only, so this is also the one action an operator
 * role cannot take.
 */
export async function confirmFinancial(approvalId: string): Promise<DecisionResult> {
  const { actor, workspace } = await requireActor()

  assert(actor, 'approval:confirm', { workspaceId: workspace.id })

  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
    select: { workspaceId: true, risk: true },
  })

  if (approval?.workspaceId !== workspace.id) {
    return { ok: false, message: 'That approval no longer exists.' }
  }

  try {
    await approvals.confirmFinancialApproval(prisma, { approvalId, decidedById: actor.id })

    await audit.record(prisma, {
      workspaceId: workspace.id,
      actor: { userId: actor.id },
      action: 'confirmed',
      resource: 'approval',
      resourceId: approvalId,
    })

    // The second signal a financial gate is waiting on. Sent separately from the
    // approval itself, because two acts is the entire point.
    await inngest.send(
      ApprovalResponded.create({
        workspaceId: workspace.id,
        approvalId,
        approved: true,
        risk: approval.risk,
        secondConfirmed: true,
      }),
    )

    revalidatePath('/approvals')
    return { ok: true, message: 'Confirmed. The payment can now proceed.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not confirm.',
    }
  }
}
