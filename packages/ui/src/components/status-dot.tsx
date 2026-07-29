import * as React from 'react'

import { cn } from '../lib/cn'

export type Status = 'idle' | 'working' | 'waiting' | 'failed' | 'off'

const TONE: Record<Status, string> = {
  idle: 'bg-muted-foreground/50',
  working: 'bg-success',
  waiting: 'bg-warning',
  failed: 'bg-destructive',
  off: 'bg-border',
}

const LABEL: Record<Status, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting for you',
  failed: 'Failed',
  off: 'Disabled',
}

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: Status
  /** Render the word alongside the dot. Colour alone is not an accessible signal. */
  withLabel?: boolean
}

/**
 * Department state at a glance.
 *
 * Only `working` animates, and only while something is genuinely running. A
 * dashboard where everything pulses teaches you to ignore movement, which
 * defeats the point of having any.
 */
export function StatusDot({ status, withLabel = false, className, ...props }: StatusDotProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)} {...props}>
      <span className="relative flex size-2 shrink-0">
        {status === 'working' ? (
          <span
            className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden"
            aria-hidden
          />
        ) : null}
        <span className={cn('relative inline-flex size-2 rounded-full', TONE[status])} />
      </span>
      {withLabel ? (
        <span className="text-xs text-muted-foreground">{LABEL[status]}</span>
      ) : (
        <span className="sr-only">{LABEL[status]}</span>
      )}
    </span>
  )
}

export { LABEL as STATUS_LABEL }
