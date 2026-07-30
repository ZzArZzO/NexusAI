import { prisma, workspaces } from '@nexusai/db'
import { createConnectorRegistry, receive } from '@nexusai/integrations'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where providers post events.
 *
 * This endpoint is reachable without a session, so its rules are stricter than
 * anywhere else in the app:
 *
 *  1. **The raw body is read as text, once.** Signatures are computed over exact
 *     bytes; parsing and re-stringifying JSON changes whitespace and key order and
 *     every signature then fails. This is the single most common cause of "my
 *     webhooks don't verify".
 *  2. **The response says nothing useful.** A 202 for accepted, a 401 for a bad
 *     signature, and no detail either way. An error message that distinguishes
 *     "unknown connector" from "wrong secret" is a probing tool.
 *  3. **Verification decides nothing else.** The connector id comes from the path,
 *     the secret from the connection's config, and no field of the payload is used
 *     until the signature has passed.
 *
 * Processing happens later, from the stored row. This handler's only job is to
 * verify and persist, so a provider's retry window is never spent waiting on our
 * work — and so a crash mid-processing loses nothing.
 */

const registry = createConnectorRegistry()

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ connector: string }> },
): Promise<NextResponse> {
  const { connector } = await context.params

  // Read once, as text. See note 1.
  const rawBody = await request.text()

  const workspace = await workspaces.getPrimaryWorkspace(prisma)
  if (!workspace) return NextResponse.json({ received: false }, { status: 404 })

  const connection = await prisma.integrationConnection.findUnique({
    where: { workspaceId_connectorId: { workspaceId: workspace.id, connectorId: connector } },
    select: { config: true },
  })

  const secret =
    connection && typeof connection.config === 'object' && connection.config !== null
      ? ((connection.config as Record<string, unknown>)['webhookSecret'] as string | undefined)
      : undefined

  if (!secret) {
    // No secret configured means nothing can be verified, so nothing is accepted.
    // Failing closed here is the point: the alternative is an endpoint that trusts
    // whatever arrives while the operator finishes setting the integration up.
    return NextResponse.json({ received: false }, { status: 401 })
  }

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  const result = await receive(prisma, {
    workspaceId: workspace.id,
    connectorId: connector,
    registry,
    request: { headers, rawBody },
    secret,
  })

  switch (result.status) {
    case 'accepted':
      return NextResponse.json({ received: true }, { status: 202 })
    case 'duplicate':
      // 200, not an error: the provider did the right thing by retrying, and
      // telling it otherwise makes it keep retrying.
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 })
    case 'unverified':
      return NextResponse.json({ received: false }, { status: 401 })
    default:
      return NextResponse.json({ received: false }, { status: 404 })
  }
}

/**
 * Some providers verify an endpoint with a GET before they will send to it.
 * Answering without revealing whether a connection exists.
 */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true })
}
