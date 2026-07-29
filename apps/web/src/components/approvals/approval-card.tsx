'use client'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@nexusai/ui'
import { formatDistanceToNowStrict } from 'date-fns'
import { ChevronDownIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { confirmFinancial, decideApproval } from '@/app/actions/approvals'

export interface PendingApproval {
  id: string
  title: string
  summary: string
  risk: string
  department: string
  toolName: string | null
  payload: unknown
  expiresAt: string
  requiresSecondConfirmation: boolean
  secondConfirmed: boolean
}

interface ApprovalCardProps {
  approval: PendingApproval
  canDecide: boolean
  canConfirm: boolean
}

/**
 * One decision.
 *
 * The exact payload is shown, collapsed by default. Approving something you
 * cannot inspect is not approval — but the raw JSON is noise until you want it,
 * so it starts folded and the human summary leads.
 */
export function ApprovalCard({ approval, canDecide, canConfirm }: ApprovalCardProps) {
  const [pending, startTransition] = useTransition()
  const [showPayload, setShowPayload] = useState(false)

  const financial = approval.risk === 'financial'
  const needsConfirmation = approval.requiresSecondConfirmation && !approval.secondConfirmed

  function decide(approved: boolean) {
    startTransition(async () => {
      const result = await decideApproval(approval.id, approved)
      toast[result.ok ? (approved ? 'success' : 'info') : 'error'](result.message)
    })
  }

  function confirm() {
    startTransition(async () => {
      const result = await confirmFinancial(approval.id)
      toast[result.ok ? 'success' : 'error'](result.message)
    })
  }

  return (
    <Card>
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{approval.title}</CardTitle>
          <Badge variant={financial ? 'danger' : 'warning'}>{approval.risk}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{approval.summary}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {approval.department}
          {approval.toolName ? ` · ${approval.toolName}` : ''} · expires in{' '}
          {formatDistanceToNowStrict(new Date(approval.expiresAt))}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              setShowPayload((value) => !value)
            }}
            className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showPayload}
          >
            <ChevronDownIcon
              className={
                showPayload
                  ? 'size-3.5 rotate-180 transition-transform'
                  : 'size-3.5 transition-transform'
              }
              aria-hidden
            />
            {showPayload ? 'Hide' : 'Show'} exactly what will run
          </button>

          {showPayload ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
              {JSON.stringify(approval.payload, null, 2)}
            </pre>
          ) : null}
        </div>

        {financial ? (
          <p className="border-l-2 border-destructive/50 pl-3 text-xs leading-relaxed text-muted-foreground">
            This moves money. Approving is the first of two steps — it will not run until you
            confirm separately.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              decide(true)
            }}
            disabled={pending || !canDecide}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              decide(false)
            }}
            disabled={pending || !canDecide}
          >
            Reject
          </Button>

          {needsConfirmation ? (
            <Button
              variant="destructive"
              onClick={confirm}
              disabled={pending || !canConfirm}
              title={canConfirm ? undefined : 'Only the workspace owner can confirm a payment.'}
            >
              Confirm payment
            </Button>
          ) : null}

          {!canDecide ? (
            <span className="text-xs text-muted-foreground">
              You do not have permission to decide approvals.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
