import * as React from 'react'

import { cn } from '../lib/cn'

/**
 * Loading placeholder.
 *
 * Shaped like the content it replaces rather than a generic grey box, so the
 * layout does not jump when real data arrives — the shift is what makes
 * streaming feel broken rather than fast.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  )
}

/** Several lines of placeholder text, last one short like a real paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 ? 'w-2/5' : 'w-full')} />
      ))}
    </div>
  )
}
