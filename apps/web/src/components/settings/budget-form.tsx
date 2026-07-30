'use client'

import { useState, useTransition } from 'react'

import { Button } from '@nexusai/ui'

import { setMonthlyBudget } from '@/app/actions/automation'

/**
 * The monthly spend limit.
 *
 * Entered in dollars and stored in micro-dollars. Empty means no limit, which is
 * shown as a hint rather than hidden behind a separate toggle — a checkbox for
 * "unlimited" plus a number is two controls for one decision.
 */
export function BudgetForm({ current }: { current: string }) {
  const [value, setValue] = useState(current)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const result = await setMonthlyBudget(value)
          setMessage({ ok: result.ok, text: result.message })
        })
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Monthly model budget</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">$</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            placeholder="no limit"
            aria-label="Monthly model budget in dollars"
            className="h-9 w-32 rounded-md border border-input bg-background px-3 font-mono text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </label>

      <p className="max-w-prose text-xs text-muted-foreground">
        Scheduled and autonomous work stops when the month&rsquo;s spend reaches this. You can still
        talk to the departments — locking you out would punish the one person who can decide what to
        do about it. Leave it empty for no limit; set it to 0 to stop autonomous work entirely.
      </p>

      {message ? (
        <p role="status" className={`text-xs ${message.ok ? 'text-success' : 'text-destructive'}`}>
          {message.text}
        </p>
      ) : null}
    </form>
  )
}
