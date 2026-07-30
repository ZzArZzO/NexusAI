import { createHmac } from 'node:crypto'

import { z } from 'zod'

import { defineConnector, type ConnectorTool } from '../connector'
import { safeEqual } from '../crypto'
import { request } from '../http'
import { withinTolerance } from '../webhook'

/**
 * Stripe.
 *
 * Read-only, deliberately. Reading the balance and recent charges is what Finance
 * actually needs to reconcile; issuing a refund or a payout is a `financial`
 * action, and rather than expose it here it stays behind Finance's own
 * `payment.send`, which requires an approval *and* a second confirmation.
 *
 * A connector that could move money would be the one place in this system where
 * the double confirmation could be bypassed, so it does not exist.
 */

const credentialSchema = z.object({
  /** Restricted key with read permissions. A full secret key is not required. */
  secretKey: z.string().startsWith('rk_').or(z.string().startsWith('sk_')),
})

type Credential = z.infer<typeof credentialSchema>
interface Client {
  secretKey: string
}

const API = 'https://api.stripe.com/v1'

/** Tools receive the client as `unknown`; this is the one place it is narrowed. */
function client(value: unknown): Client {
  return value as Client
}

function headers(value: Client): Record<string, string> {
  return {
    authorization: `Bearer ${value.secretKey}`,
    'stripe-version': '2025-10-29.clover',
  }
}

export const stripe = defineConnector<Credential, Client>({
  id: 'stripe',
  displayName: 'Stripe',
  description: 'Read balance, charges and subscriptions so Finance can reconcile real revenue.',
  auth: 'apikey',
  scopes: ['balance:read', 'charge:read', 'subscription:read'],
  capabilities: ['payments.read'],
  credentialSchema,

  connect: (credential) => Promise.resolve({ secretKey: credential.secretKey }),

  healthCheck: async (value) => {
    try {
      await request(`${API}/balance`, { headers: headers(value) })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: message, reauthorize: message.includes('401') }
    }
  },

  tools: (): ConnectorTool[] => [
    {
      name: 'stripe.balance',
      description: 'Read the current Stripe balance, available and pending.',
      risk: 'read',
      capability: 'payments.read',
      inputSchema: z.object({}),
      execute: async (_raw, value) => {
        const balance = await request<{
          available: { amount: number; currency: string }[]
          pending: { amount: number; currency: string }[]
        }>(`${API}/balance`, { headers: headers(client(value)) })

        // Stripe reports minor units. Converted here so Finance's tools receive
        // the same shape they receive from everywhere else.
        return {
          available: balance.available.map((entry) => ({
            amount: entry.amount / 100,
            currency: entry.currency.toUpperCase(),
          })),
          pending: balance.pending.map((entry) => ({
            amount: entry.amount / 100,
            currency: entry.currency.toUpperCase(),
          })),
        }
      },
    },
    {
      name: 'stripe.charges',
      description:
        'List recent charges. Use the returned ids as the external id when recording ' +
        'transactions, so importing twice does not double the month.',
      risk: 'read',
      capability: 'payments.read',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
      execute: async (raw, value) => {
        const input = z.object({ limit: z.number().default(25) }).parse(raw)

        const charges = await request<{
          data: {
            id: string
            amount: number
            currency: string
            created: number
            status: string
            description: string | null
            refunded: boolean
          }[]
        }>(`${API}/charges`, { headers: headers(client(value)), query: { limit: input.limit } })

        return {
          count: charges.data.length,
          charges: charges.data.map((charge) => ({
            id: charge.id,
            amount: charge.amount / 100,
            currency: charge.currency.toUpperCase(),
            status: charge.status,
            refunded: charge.refunded,
            description: charge.description,
            at: new Date(charge.created * 1000).toISOString(),
          })),
        }
      },
    },
    {
      name: 'stripe.subscriptions',
      description: 'List active subscriptions and what they bill.',
      risk: 'read',
      capability: 'payments.read',
      inputSchema: z.object({}),
      execute: async (_raw, value) => {
        const subs = await request<{
          data: {
            id: string
            status: string
            current_period_end: number
            items: {
              data: {
                price: { unit_amount: number | null; recurring: { interval: string } | null }
              }[]
            }
          }[]
        }>(`${API}/subscriptions`, {
          headers: headers(client(value)),
          query: { status: 'active', limit: 100 },
        })

        return {
          count: subs.data.length,
          subscriptions: subs.data.map((sub) => ({
            id: sub.id,
            status: sub.status,
            renewsAt: new Date(sub.current_period_end * 1000).toISOString().slice(0, 10),
            amount: (sub.items.data[0]?.price.unit_amount ?? 0) / 100,
            interval: sub.items.data[0]?.price.recurring?.interval ?? 'unknown',
          })),
        }
      },
    },
  ],

  /**
   * Stripe's signature scheme, which is not plain HMAC-over-body.
   *
   * The header is `t=<timestamp>,v1=<hex>[,v1=<hex>]` and the signed payload is
   * `<timestamp>.<rawBody>`. Two details matter and both have burned people:
   *
   *  - The timestamp must be checked against a tolerance, or a captured webhook
   *    replays forever with a signature that stays valid.
   *  - There can be several `v1` values during a secret rotation, and any one
   *    matching is a pass. Comparing only the first breaks every rotation.
   */
  verifyWebhook: (req, secret) => {
    const header = req.headers['stripe-signature'] ?? ''
    const parts = header.split(',').map((part) => part.trim().split('='))

    const timestamp = parts.find(([key]) => key === 't')?.[1]
    const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '')

    const eventId = extractEventId(req.rawBody)
    const eventType = extractEventType(req.rawBody)

    if (!timestamp || signatures.length === 0 || !withinTolerance(Number(timestamp))) {
      return { externalId: eventId, eventType, signatureOk: false }
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${req.rawBody}`, 'utf8')
      .digest('hex')

    return {
      externalId: eventId,
      eventType,
      signatureOk: signatures.some((signature) => safeEqual(expected, signature)),
    }
  },
})

/**
 * Read the event id from the body without trusting it for anything but
 * deduplication. It is used as a database key, never as an authorisation input,
 * and only a verified event is ever processed.
 */
function extractEventId(body: string): string {
  const match = /"id"\s*:\s*"(evt_[^"]+)"/.exec(body)
  return match?.[1] ?? `unidentified-${body.length}`
}

function extractEventType(body: string): string {
  const match = /"type"\s*:\s*"([^"]+)"/.exec(body)
  return match?.[1] ?? 'unknown'
}
