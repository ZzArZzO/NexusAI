'use client'

import { useState, useTransition } from 'react'

import { Button } from '@nexusai/ui'

import { rekeyCredentials } from '@/app/actions/integrations'

/**
 * Re-encrypt every stored credential onto the current key.
 *
 * Visible even when nothing needs it, because a rotation control the operator has
 * to go looking for is one they will not find on the day they need it. It is only
 * emphasised when at least one credential is on an older key.
 */
export function RekeyButton({ highlighted }: { highlighted: boolean }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={highlighted ? 'default' : 'outline'}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await rekeyCredentials()
            setMessage({ ok: result.ok, text: result.message })
          })
        }
      >
        {pending ? 'Re-encrypting…' : 'Re-encrypt credentials'}
      </Button>

      {message ? (
        <span
          className={`max-w-sm text-right text-xs ${message.ok ? 'text-success' : 'text-destructive'}`}
        >
          {message.text}
        </span>
      ) : null}
    </div>
  )
}
