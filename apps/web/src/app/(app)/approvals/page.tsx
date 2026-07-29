import { can } from '@nexusai/core'
import { approvals as approvalRepo, prisma } from '@nexusai/db'
import { EmptyState } from '@nexusai/ui'
import { ShieldCheckIcon } from 'lucide-react'
import type { Metadata } from 'next'

import { ApprovalCard } from '@/components/approvals/approval-card'
import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Approvals' }

export default async function ApprovalsPage() {
  const { actor, workspace } = await requireSession()

  // Expires anything overdue before listing, so the inbox never offers a
  // decision that would be refused the moment it was made.
  const pending = await approvalRepo.findPendingApprovals(prisma, workspace.id)

  const recentlyDecided = await prisma.approvalRequest.findMany({
    where: { workspaceId: workspace.id, status: { not: 'pending' } },
    orderBy: { decidedAt: 'desc' },
    take: 10,
    include: { department: { select: { displayName: true } } },
  })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Anything that would leave the system or spend money stops here first. An approval that
          expires means the action did not happen.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        {pending.length === 0 ? (
          <div className="rounded-xl border border-border">
            <EmptyState
              icon={ShieldCheckIcon}
              title="Nothing waiting"
              description="Departments can read, plan and write to their own database freely. Only actions that reach the outside world land here."
            />
          </div>
        ) : (
          pending.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={{
                id: approval.id,
                title: approval.title,
                summary: approval.summary,
                risk: approval.risk,
                department: approval.department.displayName,
                toolName: approval.toolCall?.toolName ?? null,
                payload: approval.payload,
                expiresAt: approval.expiresAt.toISOString(),
                requiresSecondConfirmation: approval.requiresSecondConfirmation,
                secondConfirmed: approval.secondConfirmedAt !== null,
              }}
              canDecide={can(actor, 'approval:decide')}
              canConfirm={can(actor, 'approval:confirm')}
            />
          ))
        )}
      </section>

      {recentlyDecided.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            Recently decided
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {recentlyDecided.map((approval) => (
              <li key={approval.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 truncate text-sm">{approval.title}</span>
                <span className="text-xs text-muted-foreground">
                  {approval.department.displayName}
                </span>
                <span
                  className={
                    approval.status === 'approved'
                      ? 'font-mono text-xs text-success'
                      : 'font-mono text-xs text-muted-foreground'
                  }
                >
                  {approval.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
