import { approvals, audit, prisma } from '@nexusai/db'

import { cron } from 'inngest'

import { inngest } from '../client'
import { ApprovalRequested, ApprovalResponded } from '../events'

/**
 * Approval gates as durable waits.
 *
 * The behaviour that matters: `step.waitForEvent` returns `null` on timeout, and
 * null resolves to *not done*. There is no branch that treats an unanswered
 * request as permission. A workflow parked here survives a restart, a redeploy
 * and three days of the operator being on holiday — and if they never answer, the
 * action simply never happened.
 */

export const awaitApproval = inngest.createFunction(
  {
    id: 'approval-await',
    name: 'Wait for an approval decision',
    triggers: [ApprovalRequested],
    // No retries: re-running a wait would create a second gate for the same
    // action, and the operator would see a duplicate they cannot distinguish.
    retries: 0,
  },
  async ({ event, step }) => {
    const { workspaceId, approvalId, department, risk, title } = event.data

    await step.run('notify', async () => {
      await prisma.notification.create({
        data: {
          workspaceId,
          level: risk === 'financial' ? 'critical' : 'warning',
          title: `${department} needs your approval`,
          body: title,
          href: '/approvals',
        },
      })
    })

    const timeout = await step.run('read-timeout', async () => {
      const approval = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: approvalId },
        select: { expiresAt: true },
      })
      return approval.expiresAt.toISOString()
    })

    const decision = await step.waitForEvent('await-decision', {
      event: ApprovalResponded,
      // Matched on the approval, not the run: one run can park several times, and
      // each gate must resolve independently.
      match: 'data.approvalId',
      timeout: new Date(timeout),
    })

    // The null branch is the entire point of the design.
    if (!decision) {
      await step.run('expire', async () => {
        await approvals.expireOverdueApprovals(prisma, workspaceId)

        await audit.record(prisma, {
          workspaceId,
          actor: { system: 'approval-expiry' },
          action: 'expired',
          resource: 'approval',
          resourceId: approvalId,
          metadata: { reason: 'no decision before the deadline', risk },
        })

        await prisma.notification.create({
          data: {
            workspaceId,
            level: 'info',
            title: 'An approval expired',
            body: `"${title}" was never decided, so nothing happened.`,
            href: '/approvals',
          },
        })
      })

      return { status: 'expired' as const, executed: false }
    }

    if (!decision.data.approved) {
      return { status: 'rejected' as const, executed: false }
    }

    // Financial actions need a second, separate act. Approving is consent to
    // consider it; confirming is consent to do it.
    if (risk === 'financial' && !decision.data.secondConfirmed) {
      const confirmation = await step.waitForEvent('await-confirmation', {
        event: ApprovalResponded,
        if: `event.data.approvalId == async.data.approvalId && async.data.secondConfirmed == true`,
        timeout: new Date(timeout),
      })

      if (!confirmation) {
        return { status: 'unconfirmed' as const, executed: false }
      }
    }

    return { status: 'approved' as const, executed: true }
  },
)

/**
 * Sweep expired approvals.
 *
 * Belt and braces: `awaitApproval` expires its own gate, but an approval created
 * outside a workflow — or one whose workflow was lost before Inngest was
 * self-hosted — would otherwise sit pending forever and read as actionable.
 */
export const expireApprovals = inngest.createFunction(
  {
    id: 'approval-expiry-sweep',
    name: 'Expire overdue approvals',
    triggers: [cron('TZ=Etc/UTC */15 * * * *')],
  },
  async ({ step }) => {
    const workspaceIds = await step.run('list-workspaces', async () => {
      const rows = await prisma.workspace.findMany({ select: { id: true } })
      return rows.map((row) => row.id)
    })

    let expired = 0

    for (const workspaceId of workspaceIds) {
      expired += await step.run(`expire-${workspaceId}`, () =>
        approvals.expireOverdueApprovals(prisma, workspaceId),
      )
    }

    return { expired }
  },
)
