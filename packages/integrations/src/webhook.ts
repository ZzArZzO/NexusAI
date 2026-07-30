import { createHmac } from 'node:crypto'

import type { PrismaClient } from '@nexusai/db'

import type { WebhookRequest, WebhookVerification } from './connector'
import { safeEqual } from './crypto'
import type { ConnectorRegistry } from './registry'

/**
 * Inbound webhooks.
 *
 * Three rules, in order, and the order is the point:
 *
 *  1. **Verify before anything else.** Nothing derived from an unverified payload
 *     is used — not the event type, not the id, not a decision to skip work.
 *  2. **Store, then process.** The row is written first so a crash during
 *     processing loses nothing and the retry is a database read, not a lost event.
 *  3. **Deduplicate on the provider's id.** Providers retry aggressively and at
 *     least one of every pair of retries is a duplicate. Processing a payment
 *     event twice is not a hypothetical.
 *
 * Unverified events are recorded with `signatureOk: false` and never processed.
 * Discarding them silently would erase the evidence of someone probing the
 * endpoint, which is exactly when the record matters.
 */

export interface ReceiveResult {
  status: 'accepted' | 'duplicate' | 'unverified' | 'unknown_connector' | 'not_connected'
  eventId?: string
  eventType?: string
}

export async function receive(
  prisma: PrismaClient,
  params: {
    workspaceId: string
    connectorId: string
    registry: ConnectorRegistry
    request: WebhookRequest
    /** The shared secret for this connection's webhooks. */
    secret: string
  },
): Promise<ReceiveResult> {
  const connector = params.registry.get(params.connectorId)
  if (!connector?.verifyWebhook) {
    return { status: 'unknown_connector' }
  }

  const connection = await prisma.integrationConnection.findUnique({
    where: {
      workspaceId_connectorId: {
        workspaceId: params.workspaceId,
        connectorId: params.connectorId,
      },
    },
    select: { id: true },
  })

  // No connection means nothing legitimately sends here. Recorded nowhere,
  // because there is no connection row to hang the event off — the caller logs
  // the rejection.
  if (!connection) return { status: 'not_connected' }

  let verification: WebhookVerification
  try {
    verification = connector.verifyWebhook(params.request, params.secret)
  } catch {
    // A connector that throws while verifying is treated as a failed
    // verification, never as a pass. Any other reading of an exception here is a
    // vulnerability.
    verification = {
      externalId: `malformed-${Date.now()}`,
      eventType: 'unknown',
      signatureOk: false,
    }
  }

  const payload: unknown = verification.signatureOk ? safeParse(params.request.rawBody) : {}

  try {
    const event = await prisma.webhookEvent.create({
      data: {
        connectionId: connection.id,
        externalId: verification.externalId,
        eventType: verification.eventType,
        payload: payload as object,
        signatureOk: verification.signatureOk,
        // An unverified event is closed out immediately with a reason, so it can
        // never be picked up by the processing sweep.
        ...(verification.signatureOk
          ? {}
          : { processedAt: new Date(), error: 'Signature verification failed. Not processed.' }),
      },
      select: { id: true },
    })

    return verification.signatureOk
      ? { status: 'accepted', eventId: event.id, eventType: verification.eventType }
      : { status: 'unverified', eventId: event.id }
  } catch (error) {
    // The unique index on (connectionId, externalId) is the deduplication. Racing
    // retries both reach the insert; one loses, and losing is the correct outcome.
    if (isUniqueViolation(error)) {
      return { status: 'duplicate', eventType: verification.eventType }
    }
    throw error
  }
}

/** Events waiting to be processed, oldest first. */
export async function pendingEvents(
  prisma: PrismaClient,
  params: { workspaceId: string; limit?: number },
): Promise<
  { id: string; connectorId: string; eventType: string; payload: unknown; receivedAt: Date }[]
> {
  const rows = await prisma.webhookEvent.findMany({
    where: {
      processedAt: null,
      signatureOk: true,
      connection: { workspaceId: params.workspaceId },
    },
    orderBy: { receivedAt: 'asc' },
    take: params.limit ?? 50,
    include: { connection: { select: { connectorId: true } } },
  })

  return rows.map((row) => ({
    id: row.id,
    connectorId: row.connection.connectorId,
    eventType: row.eventType,
    payload: row.payload,
    receivedAt: row.receivedAt,
  }))
}

export async function markProcessed(
  prisma: PrismaClient,
  params: { eventId: string; error?: string },
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: params.eventId },
    data: {
      processedAt: new Date(),
      ...(params.error === undefined ? {} : { error: params.error }),
    },
  })
}

/**
 * HMAC signature check, the shape most providers use.
 *
 * `signedPayload` is passed in rather than assembled here because providers
 * disagree about what gets signed — Stripe prefixes the timestamp, GitHub signs
 * the body alone. Getting that string wrong produces a verifier that rejects
 * everything, or worse, one that accepts anything.
 */
export function verifyHmac(params: {
  signedPayload: string
  secret: string
  signature: string
  algorithm?: 'sha256' | 'sha1'
  /** Prefix the provider puts on the header value, e.g. `sha256=`. */
  prefix?: string
}): boolean {
  const expected = createHmac(params.algorithm ?? 'sha256', params.secret)
    .update(params.signedPayload, 'utf8')
    .digest('hex')

  return safeEqual(`${params.prefix ?? ''}${expected}`, params.signature)
}

/**
 * Reject a signature whose timestamp is too old.
 *
 * Without this, a captured-but-valid webhook can be replayed forever: the
 * signature never expires on its own.
 */
export function withinTolerance(timestampSeconds: number, toleranceSeconds = 300): boolean {
  const age = Math.abs(Date.now() / 1000 - timestampSeconds)
  return age <= toleranceSeconds
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return { unparseable: true, raw: body.slice(0, 2000) }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}
