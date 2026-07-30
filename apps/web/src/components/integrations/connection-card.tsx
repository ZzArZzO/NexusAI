'use client'

import { useState, useTransition } from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, StatusDot } from '@nexusai/ui'
import { formatDistanceToNowStrict } from 'date-fns'

import {
  connectIntegration,
  disconnectIntegration,
  testIntegration,
} from '@/app/actions/integrations'

/**
 * One connector, connected or not.
 *
 * The credential is typed as JSON rather than into per-field inputs. That is a
 * deliberate trade: generating a form from a Zod schema for six connectors with
 * different shapes would be a small framework, and this is a single-operator
 * system where the shape is printed on screen beside the box. What the operator
 * gets instead is the connector's real validation error, naming the field.
 *
 * The value is never sent back down. After a successful connect the box is
 * cleared, and a stored credential has no representation in this component at all.
 */

export interface ConnectionState {
  connectorId: string
  displayName: string
  description: string
  auth: string
  capabilities: string[]
  /** Shape of the credential this connector expects, for the placeholder. */
  credentialExample: string
  configExample: string | null
  connected: boolean
  status: string
  grantedCapabilities: string[]
  lastCheckedAt: string | null
  lastError: string | null
  needsRekey: boolean
  webhookPath: string | null
}

export function ConnectionCard({ connection }: { connection: ConnectionState }) {
  const [open, setOpen] = useState(false)
  const [credential, setCredential] = useState('')
  const [config, setConfig] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    startTransition(async () => {
      const result = await connectIntegration(connection.connectorId, credential, config)
      setFeedback(result)

      if (result.ok) {
        // Cleared on success only. A failed attempt keeps what was typed, because
        // retyping a token to fix a missing brace is miserable.
        setCredential('')
        setConfig('')
        setOpen(false)
      }
    })
  }

  const dotStatus =
    connection.status === 'connected'
      ? 'working'
      : connection.status === 'expired'
        ? 'waiting'
        : connection.status === 'error'
          ? 'failed'
          : 'idle'

  return (
    // Identified by connector id so a test — and a support conversation — can name
    // one card among six that share every label.
    <Card className="min-w-0" data-testid={`connector-${connection.connectorId}`}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{connection.displayName}</CardTitle>
          <StatusDot status={dotStatus} withLabel />
        </div>

        <p className="text-sm text-muted-foreground">{connection.description}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[0.65rem]">
            {connection.auth}
          </Badge>
          {(connection.connected ? connection.grantedCapabilities : connection.capabilities).map(
            (capability) => (
              <Badge
                key={capability}
                variant={connection.connected ? 'accent' : 'outline'}
                className="font-mono text-[0.65rem]"
              >
                {capability}
              </Badge>
            ),
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0">
        {connection.lastError ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {connection.lastError}
          </p>
        ) : null}

        {connection.needsRekey ? (
          <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
            Encrypted with an older key. Re-encrypt from the button at the top of this page.
          </p>
        ) : null}

        {connection.connected && connection.webhookPath ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Point this provider&rsquo;s webhooks here, and put the signing secret in the config as{' '}
              <code className="font-mono">webhookSecret</code>:
            </span>
            <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">
              {connection.webhookPath}
            </code>
          </div>
        ) : null}

        {feedback ? (
          <p
            role="status"
            className={`text-xs ${feedback.ok ? 'text-success' : 'text-destructive'}`}
          >
            {feedback.message}
          </p>
        ) : null}

        {open ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Credential (JSON)</span>
              <textarea
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                placeholder={connection.credentialExample}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            {connection.configExample ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Settings (JSON, optional)</span>
                <textarea
                  value={config}
                  onChange={(event) => setConfig(event.target.value)}
                  placeholder={connection.configExample}
                  rows={2}
                  spellCheck={false}
                  className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            ) : null}

            <div className="flex gap-2">
              <Button size="sm" onClick={submit} disabled={pending || credential.trim() === ''}>
                {pending ? 'Connecting…' : 'Connect'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={connection.connected ? 'outline' : 'default'}
              onClick={() => setOpen(true)}
            >
              {connection.connected ? 'Replace credential' : 'Connect'}
            </Button>

            {connection.connected ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setFeedback(await testIntegration(connection.connectorId))
                    })
                  }
                >
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setFeedback(await disconnectIntegration(connection.connectorId))
                    })
                  }
                >
                  Disconnect
                </Button>
              </>
            ) : null}
          </div>
        )}

        {connection.lastCheckedAt ? (
          <span className="font-mono text-xs text-muted-foreground">
            checked {formatDistanceToNowStrict(new Date(connection.lastCheckedAt))} ago
          </span>
        ) : null}
      </CardContent>
    </Card>
  )
}
