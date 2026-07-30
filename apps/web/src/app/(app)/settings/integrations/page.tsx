import { can, DEPARTMENT_CAPABILITIES, DEPARTMENT_IDS } from '@nexusai/core'
import { prisma } from '@nexusai/db'
import { createConnectorRegistry, listConnections } from '@nexusai/integrations'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@nexusai/ui'
import type { Metadata } from 'next'

import { RekeyButton } from '@/components/integrations/rekey-button'
import { ConnectionCard, type ConnectionState } from '@/components/integrations/connection-card'
import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Integrations' }

/**
 * Connecting the company to the outside world.
 *
 * The page is organised around *capabilities* rather than around vendors, because
 * that is the question the operator actually has: not "is Slack connected" but
 * "can this company send email yet, and who is allowed to". A capability nothing
 * provides is shown as unavailable rather than hidden, so the gap is visible.
 */

/** Example credential shapes, shown as placeholders beside the input. */
const CREDENTIAL_EXAMPLES: Record<string, string> = {
  github: '{ "token": "github_pat_…" }',
  google:
    '{ "refreshToken": "1//…", "clientId": "….apps.googleusercontent.com", "clientSecret": "GOCSPX-…" }',
  slack: '{ "botToken": "xoxb-…" }',
  stripe: '{ "secretKey": "rk_live_…" }',
  notion: '{ "token": "ntn_…" }',
  mcp: '{ "url": "https://example.com/mcp", "slug": "example", "token": "optional" }',
}

const CONFIG_EXAMPLES: Record<string, string> = {
  github: '{ "defaultRepo": "owner/name", "webhookSecret": "…" }',
  slack: '{ "defaultChannel": "C0123456789", "webhookSecret": "…" }',
  stripe: '{ "webhookSecret": "whsec_…" }',
}

/** Connectors that receive webhooks, and therefore have an inbound URL. */
const HAS_WEBHOOKS = new Set(['github', 'slack', 'stripe'])

export default async function IntegrationsPage() {
  const { actor, workspace } = await requireSession()

  const registry = createConnectorRegistry()
  const connections = await listConnections(prisma, workspace.id)
  const byId = new Map(connections.map((connection) => [connection.connectorId, connection]))

  const appUrl = process.env['APP_URL'] ?? 'http://localhost:3200'

  const cards: ConnectionState[] = registry.all().map((connector) => {
    const connection = byId.get(connector.id)

    return {
      connectorId: connector.id,
      displayName: connector.displayName,
      description: connector.description,
      auth: connector.auth,
      capabilities: [...connector.capabilities],
      credentialExample: CREDENTIAL_EXAMPLES[connector.id] ?? '{ … }',
      configExample: CONFIG_EXAMPLES[connector.id] ?? null,
      connected: connection?.status === 'connected',
      status: connection?.status ?? 'disconnected',
      grantedCapabilities: connection?.capabilities ?? [],
      lastCheckedAt: connection?.lastCheckedAt?.toISOString() ?? null,
      lastError: connection?.lastError ?? null,
      needsRekey: connection?.needsRekey ?? false,
      webhookPath: HAS_WEBHOOKS.has(connector.id) ? `${appUrl}/api/webhooks/${connector.id}` : null,
    }
  })

  // What the workspace can actually do right now, from healthy connections only.
  const live = new Set(
    connections
      .filter((connection) => connection.status === 'connected')
      .flatMap((connection) => connection.capabilities),
  )

  const catalogue = registry.catalogue()
  const anyRekeyNeeded = connections.some((connection) => connection.needsRekey)
  const mayConnect = can(actor, 'integration:connect')

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Credentials are encrypted before they are stored and are never shown again. Connecting a
            service grants nothing by itself — each department only receives the capabilities it was
            granted, and anything that leaves the system still stops for your approval.
          </p>
        </div>
        {mayConnect ? <RekeyButton highlighted={anyRekeyNeeded} /> : null}
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            What the company can do
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {catalogue.map(({ capability, connectors }) => {
              const available = live.has(capability)
              const departments = DEPARTMENT_IDS.filter((id) =>
                DEPARTMENT_CAPABILITIES[id].includes(capability),
              )

              return (
                <div key={capability} className="flex items-baseline gap-2 py-0.5">
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                      available ? 'bg-success' : 'bg-muted-foreground/30'
                    }`}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-mono text-xs">{capability}</span>
                    <span className="text-xs text-muted-foreground">
                      {available
                        ? `via ${connectors.join(', ')}`
                        : `needs ${connectors.join(' or ')}`}
                      {departments.length > 0
                        ? ` · ${departments.join(', ')}`
                        : ' · granted to no department'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {mayConnect ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map((card) => (
            <ConnectionCard key={card.connectorId} connection={card} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map((card) => (
            <Card key={card.connectorId}>
              <CardHeader className="gap-2 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">{card.displayName}</CardTitle>
                  <Badge variant={card.connected ? 'accent' : 'outline'}>{card.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{card.description}</p>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
