import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '../lib/cn'

/**
 * Note the explicit `| undefined` on every optional prop. With
 * `exactOptionalPropertyTypes` on — which is worth keeping for domain types and
 * database inputs, where "absent" and "explicitly undefined" genuinely differ —
 * a React prop that may receive `undefined` from a ternary has to say so.
 */
export interface EmptyStateProps {
  icon?: LucideIcon | undefined
  title: string
  /** What to do about it. An empty state that only says "nothing here" wastes the space. */
  description?: string | undefined
  action?: ReactNode | undefined
  className?: string | undefined
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="size-5 text-muted-foreground/60" aria-hidden /> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
