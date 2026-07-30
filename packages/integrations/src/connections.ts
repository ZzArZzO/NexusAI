import { audit, type Prisma, type PrismaClient } from '@nexusai/db'

import type { AnyConnector, Capability, HealthStatus } from './connector'
import { keyRingFromEnv, needsRotation, open, seal, type KeyRing } from './crypto'
import type { ConnectorRegistry } from './registry'

/**
 * Connection lifecycle: connect, load, health-check, disconnect.
 *
 * This is the only module that decrypts a credential, and it never returns one to
 * its caller. `withClient` hands back a *connected client* instead, so a route
 * handler or a tool literally cannot hold a token — the token exists inside one
 * function call and is unreachable from outside it.
 *
 * Everything here writes an audit entry, and nothing here writes a credential to
 * one. The audit log records that a connection happened, never what it contained.
 */

export interface ConnectionSummary {
  id: string
  connectorId: string
  displayName: string
  status: 'connected' | 'disconnected' | 'error' | 'expired'
  capabilities: string[]
  lastCheckedAt: Date | null
  lastError: string | null
  /** True when the stored credential is on an old key and should be re-sealed. */
  needsRekey: boolean
  expiresAt: Date | null
}

let cachedRing: KeyRing | undefined

/** The process key ring. Built once; throws loudly if no key is configured. */
export function keyRing(): KeyRing {
  cachedRing ??= keyRingFromEnv()
  return cachedRing
}

/** Test seam: drop the cached ring so a test can install its own keys. */
export function resetKeyRing(): void {
  cachedRing = undefined
}

export async function connect(
  prisma: PrismaClient,
  params: {
    workspaceId: string
    connector: AnyConnector
    /** Raw credential, validated against the connector's schema before sealing. */
    credential: unknown
    config?: Record<string, unknown>
    /** Capabilities actually granted. Defaults to everything the connector declares. */
    grantedCapabilities?: readonly Capability[]
    expiresAt?: Date
    userId?: string
  },
): Promise<ConnectionSummary> {
  const { connector } = params

  // Validate before encrypting: a malformed credential sealed into the database
  // fails at use time, in a connector, with no way to see what is wrong.
  const credential: unknown = connector.credentialSchema.parse(params.credential)
  const sealed = seal(credential, keyRing())

  const granted = params.grantedCapabilities ?? connector.capabilities

  const connection = await prisma.integrationConnection.upsert({
    where: {
      workspaceId_connectorId: {
        workspaceId: params.workspaceId,
        connectorId: connector.id,
      },
    },
    update: {
      status: 'connected',
      capabilities: [...granted],
      config: (params.config ?? {}) as Prisma.InputJsonObject,
      lastError: null,
      lastCheckedAt: new Date(),
    },
    create: {
      workspaceId: params.workspaceId,
      connectorId: connector.id,
      displayName: connector.displayName,
      status: 'connected',
      capabilities: [...granted],
      config: (params.config ?? {}) as Prisma.InputJsonObject,
    },
    select: { id: true },
  })

  await prisma.integrationCredential.upsert({
    where: { connectionId: connection.id },
    update: {
      ciphertext: sealed.envelope,
      keyVersion: sealed.keyVersion,
      ...(params.expiresAt === undefined ? {} : { expiresAt: params.expiresAt }),
    },
    create: {
      connectionId: connection.id,
      ciphertext: sealed.envelope,
      keyVersion: sealed.keyVersion,
      ...(params.expiresAt === undefined ? {} : { expiresAt: params.expiresAt }),
    },
  })

  await audit.record(prisma, {
    workspaceId: params.workspaceId,
    actor: params.userId === undefined ? { system: 'integrations' } : { userId: params.userId },
    action: 'connected',
    resource: `integration:${connector.id}`,
    resourceId: connection.id,
    // Capabilities only. The credential is never in an audit payload, which is
    // the whole reason this metadata is written by hand rather than spread from
    // the params.
    metadata: { capabilities: [...granted] },
  })

  return summarise(prisma, connection.id)
}

/**
 * Run something with a connected client.
 *
 * The credential is decrypted, used to build a client, and goes out of scope when
 * this function returns. Callers get the client, never the token.
 */
export async function withClient<TResult>(
  prisma: PrismaClient,
  params: { workspaceId: string; connectorId: string; registry: ConnectorRegistry },
  fn: (client: unknown, connection: ConnectionSummary) => Promise<TResult>,
): Promise<TResult> {
  const connector = params.registry.require(params.connectorId)

  const row = await prisma.integrationConnection.findUnique({
    where: {
      workspaceId_connectorId: {
        workspaceId: params.workspaceId,
        connectorId: params.connectorId,
      },
    },
    include: { credential: true },
  })

  if (!row?.credential) {
    throw new NotConnectedError(params.connectorId)
  }

  if (row.credential.expiresAt && row.credential.expiresAt.getTime() < Date.now()) {
    // Marked, not silently refreshed. An expired credential is a fact the
    // operator should see in the UI, and refreshing it here would hide a
    // connector whose refresh flow is broken.
    await prisma.integrationConnection.update({
      where: { id: row.id },
      data: { status: 'expired' },
    })
    throw new CredentialExpiredError(params.connectorId)
  }

  const credential = open(row.credential.ciphertext, keyRing())
  const client = await connector.connect(credential as never, row.config)

  return fn(client, await summarise(prisma, row.id))
}

/** Health-check a connection and record the verdict. */
export async function checkHealth(
  prisma: PrismaClient,
  params: { workspaceId: string; connectorId: string; registry: ConnectorRegistry },
): Promise<HealthStatus> {
  const connector = params.registry.require(params.connectorId)

  try {
    return await withClient(prisma, params, async (client) => {
      const status = await connector.healthCheck(client as never)

      await prisma.integrationConnection.update({
        where: {
          workspaceId_connectorId: {
            workspaceId: params.workspaceId,
            connectorId: params.connectorId,
          },
        },
        data: {
          lastCheckedAt: new Date(),
          status: status.ok ? 'connected' : status.reauthorize ? 'expired' : 'error',
          lastError: status.ok ? null : status.reason,
        },
      })

      return status
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, reason, reauthorize: error instanceof CredentialExpiredError }
  }
}

/**
 * Disconnect.
 *
 * The credential row is deleted; the connection row is kept and marked
 * disconnected. That asymmetry is deliberate — the secret should genuinely be
 * gone, but the record that this workspace once connected Stripe is history, and
 * history is not ours to erase.
 */
export async function disconnect(
  prisma: PrismaClient,
  params: { workspaceId: string; connectorId: string; userId?: string },
): Promise<void> {
  const row = await prisma.integrationConnection.findUnique({
    where: {
      workspaceId_connectorId: {
        workspaceId: params.workspaceId,
        connectorId: params.connectorId,
      },
    },
    select: { id: true },
  })

  if (!row) return

  await prisma.integrationCredential.deleteMany({ where: { connectionId: row.id } })
  await prisma.integrationConnection.update({
    where: { id: row.id },
    data: { status: 'disconnected', lastError: null },
  })

  await audit.record(prisma, {
    workspaceId: params.workspaceId,
    actor: params.userId === undefined ? { system: 'integrations' } : { userId: params.userId },
    action: 'disconnected',
    resource: `integration:${params.connectorId}`,
    resourceId: row.id,
  })
}

/** Every connection in a workspace, for the settings page. */
export async function listConnections(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<ConnectionSummary[]> {
  const rows = await prisma.integrationConnection.findMany({
    where: { workspaceId },
    orderBy: { connectorId: 'asc' },
    include: { credential: { select: { keyVersion: true, expiresAt: true } } },
  })

  const ring = keyRing()

  return rows.map((row) => ({
    id: row.id,
    connectorId: row.connectorId,
    displayName: row.displayName,
    status: row.status,
    capabilities: row.capabilities,
    lastCheckedAt: row.lastCheckedAt,
    lastError: row.lastError,
    needsRekey: row.credential ? needsRotation(row.credential.keyVersion, ring) : false,
    expiresAt: row.credential?.expiresAt ?? null,
  }))
}

/**
 * Which capabilities this workspace actually has right now.
 *
 * Only from connections that are `connected` — a capability from a broken
 * connection is worse than a missing one, because an agent will plan around it.
 */
export async function grantedCapabilities(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<Set<string>> {
  const rows = await prisma.integrationConnection.findMany({
    where: { workspaceId, status: 'connected' },
    select: { capabilities: true },
  })

  return new Set(rows.flatMap((row) => row.capabilities))
}

/**
 * Re-seal every credential onto the current key.
 *
 * Rotation is a loop, not a migration, because each row must be decrypted with
 * whichever key it was written under. Rows whose key is missing are reported
 * rather than skipped silently — an unreadable credential is a connection that
 * will fail the next time an agent relies on it.
 */
export async function rekeyAll(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<{ rekeyed: number; unreadable: string[] }> {
  const ring = keyRing()
  const rows = await prisma.integrationConnection.findMany({
    where: { workspaceId },
    include: { credential: true },
  })

  let rekeyed = 0
  const unreadable: string[] = []

  for (const row of rows) {
    if (!row.credential) continue
    if (!needsRotation(row.credential.keyVersion, ring)) continue

    try {
      const plaintext = open(row.credential.ciphertext, ring)
      const sealed = seal(plaintext, ring)

      await prisma.integrationCredential.update({
        where: { connectionId: row.id },
        data: { ciphertext: sealed.envelope, keyVersion: sealed.keyVersion },
      })
      rekeyed += 1
    } catch {
      unreadable.push(row.connectorId)
    }
  }

  return { rekeyed, unreadable }
}

async function summarise(prisma: PrismaClient, connectionId: string): Promise<ConnectionSummary> {
  const row = await prisma.integrationConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { credential: { select: { keyVersion: true, expiresAt: true } } },
  })

  return {
    id: row.id,
    connectorId: row.connectorId,
    displayName: row.displayName,
    status: row.status,
    capabilities: row.capabilities,
    lastCheckedAt: row.lastCheckedAt,
    lastError: row.lastError,
    needsRekey: row.credential ? needsRotation(row.credential.keyVersion, keyRing()) : false,
    expiresAt: row.credential?.expiresAt ?? null,
  }
}

export class NotConnectedError extends Error {
  constructor(connectorId: string) {
    super(`${connectorId} is not connected. Connect it in Settings → Integrations first.`)
    this.name = 'NotConnectedError'
  }
}

export class CredentialExpiredError extends Error {
  constructor(connectorId: string) {
    super(`${connectorId}'s credential has expired and needs to be reauthorised.`)
    this.name = 'CredentialExpiredError'
  }
}
