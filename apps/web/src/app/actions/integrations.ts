'use server'

import { assert } from '@nexusai/core'
import { prisma } from '@nexusai/db'
import {
  checkHealth,
  connect,
  createConnectorRegistry,
  disconnect,
  rekeyAll,
} from '@nexusai/integrations'
import { revalidatePath } from 'next/cache'

import { requireActor } from '@/lib/session'

/**
 * Connecting and disconnecting integrations.
 *
 * The credential arrives here as JSON typed by the operator and is validated
 * against the connector's own schema before it is encrypted — a malformed
 * credential sealed into the database fails later, inside a connector, with no way
 * to see what was wrong.
 *
 * Nothing in this file returns a credential, echoes one in an error, or writes one
 * to an audit entry. The only value that ever leaves is a status.
 */

const registry = createConnectorRegistry()

export interface IntegrationResult {
  ok: boolean
  message: string
}

export async function connectIntegration(
  connectorId: string,
  credentialJson: string,
  configJson: string,
): Promise<IntegrationResult> {
  const { actor, workspace } = await requireActor()

  // `integration:connect` is deliberately absent from every department's
  // permission set — an agent cannot connect itself to anything.
  assert(actor, 'integration:connect', { workspaceId: workspace.id })

  const connector = registry.get(connectorId)
  if (!connector) return { ok: false, message: 'No connector by that id.' }

  let credential: unknown
  let config: Record<string, unknown>

  try {
    credential = JSON.parse(credentialJson)
    config = configJson.trim() === '' ? {} : (JSON.parse(configJson) as Record<string, unknown>)
  } catch {
    return { ok: false, message: 'That is not valid JSON.' }
  }

  try {
    await connect(prisma, {
      workspaceId: workspace.id,
      connector,
      credential,
      config,
      userId: actor.id,
    })
  } catch (error) {
    // Zod's message names the field and what was wrong with it, which is safe —
    // it describes the shape, not the value.
    return {
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 400) : 'Could not connect.',
    }
  }

  // Connect, then verify. Storing a credential that does not work and calling it
  // connected is how an agent ends up planning around a capability it lacks.
  const health = await checkHealth(prisma, {
    workspaceId: workspace.id,
    connectorId,
    registry,
  })

  revalidatePath('/settings/integrations')

  return health.ok
    ? { ok: true, message: `Connected. ${health.detail ?? ''}`.trim() }
    : {
        ok: false,
        message: `Stored, but the credential did not work: ${health.reason.slice(0, 300)}`,
      }
}

export async function disconnectIntegration(connectorId: string): Promise<IntegrationResult> {
  const { actor, workspace } = await requireActor()
  assert(actor, 'integration:connect', { workspaceId: workspace.id })

  await disconnect(prisma, { workspaceId: workspace.id, connectorId, userId: actor.id })
  revalidatePath('/settings/integrations')

  return { ok: true, message: 'Disconnected. The stored credential has been deleted.' }
}

export async function testIntegration(connectorId: string): Promise<IntegrationResult> {
  const { actor, workspace } = await requireActor()
  assert(actor, 'integration:read', { workspaceId: workspace.id })

  const health = await checkHealth(prisma, { workspaceId: workspace.id, connectorId, registry })
  revalidatePath('/settings/integrations')

  return health.ok
    ? { ok: true, message: health.detail ?? 'Working.' }
    : { ok: false, message: health.reason.slice(0, 300) }
}

/**
 * Re-seal every credential onto the current encryption key.
 *
 * Surfaced as an action rather than left to a script, because the operator is the
 * only person who will ever rotate this key and they should be able to see that it
 * worked — including which credentials could *not* be re-read, which is the part
 * that matters and the part a silent script would hide.
 */
export async function rekeyCredentials(): Promise<IntegrationResult> {
  const { actor, workspace } = await requireActor()
  assert(actor, 'integration:connect', { workspaceId: workspace.id })

  const result = await rekeyAll(prisma, workspace.id)
  revalidatePath('/settings/integrations')

  if (result.unreadable.length > 0) {
    return {
      ok: false,
      message:
        `Re-encrypted ${String(result.rekeyed)}. Could not read: ${result.unreadable.join(', ')} — ` +
        `restore the old key, or reconnect those.`,
    }
  }

  return {
    ok: true,
    message:
      result.rekeyed === 0
        ? 'Everything is already on the current key.'
        : `Re-encrypted ${String(result.rekeyed)} credentials.`,
  }
}
