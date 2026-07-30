import { type Capability, type DepartmentId, DEPARTMENT_CAPABILITIES } from '@nexusai/core'
import type { PrismaClient } from '@nexusai/db'
import {
  listConnections,
  withClient,
  type ConnectorRegistry,
  type ConnectorTool,
} from '@nexusai/integrations'
import type { z } from 'zod'

import { defineTool, type NexusTool } from './registry'

/**
 * Connector tools, folded into the agent tool registry.
 *
 * This is the join between two packages that were built to stay apart, and the
 * single most important property is what it does *not* do: a connector tool does
 * not get its own execution path. It is wrapped by the same `defineTool` as every
 * native tool, so it inherits the permission check, the approval gate, the
 * tool_call record and the audit entry. `gmail.send` is gated for exactly the same
 * reason and by exactly the same code as `outreach.send`.
 *
 * The client is built inside `execute`, per call, via `withClient` — so a
 * credential is decrypted only when a tool actually runs, and never lives in the
 * registry.
 */

export interface ConnectorToolOptions {
  prisma: PrismaClient
  registry: ConnectorRegistry
  workspaceId: string
  /** Grants are per department: a capability nobody was granted reaches nobody. */
  department: DepartmentId
  /**
   * Ask connected MCP servers what tools they have. Off by default because it is a
   * network round trip per server, and an interactive chat should not wait on one.
   */
  discover?: boolean
}

/**
 * Permission a connector tool requires, derived from its capability.
 *
 * Derived rather than declared by connector authors, so a third-party connector
 * cannot claim a cheaper permission than its capability implies.
 */
const PERMISSION_BY_CAPABILITY: Record<Capability, string> = {
  'email.read': 'task:read',
  'email.send': 'task:update',
  'calendar.read': 'task:read',
  'calendar.write': 'task:create',
  'files.read': 'memory:read',
  'files.write': 'memory:create',
  'repo.read': 'task:read',
  'repo.write': 'task:update',
  'chat.read': 'task:read',
  'chat.send': 'task:update',
  'social.read': 'task:read',
  'social.publish': 'task:update',
  'payments.read': 'kpi:read',
  'payments.write': 'kpi:update',
  'docs.read': 'memory:read',
  'docs.write': 'memory:create',
  'crm.read': 'task:read',
  'crm.write': 'task:update',
  'mcp.tools': 'task:update',
}

export interface ConnectorToolSet {
  tools: NexusTool<z.ZodType>[]
  /** Names, so the caller can extend a department's allowlist with them. */
  names: string[]
  /** Connectors that are connected but could not be reached, for the UI to show. */
  unavailable: { connectorId: string; reason: string }[]
}

export async function createConnectorTools(
  options: ConnectorToolOptions,
): Promise<ConnectorToolSet> {
  const granted = new Set<string>(DEPARTMENT_CAPABILITIES[options.department])
  const connections = await listConnections(options.prisma, options.workspaceId)

  const tools: NexusTool<z.ZodType>[] = []
  const unavailable: { connectorId: string; reason: string }[] = []

  for (const connection of connections) {
    // Only healthy connections contribute. A capability from a broken connection is
    // worse than a missing one, because an agent will plan around it and then fail
    // halfway through.
    if (connection.status !== 'connected') continue

    const connector = options.registry.get(connection.connectorId)
    if (!connector) {
      unavailable.push({
        connectorId: connection.connectorId,
        reason: 'Connected, but this build has no connector by that id.',
      })
      continue
    }

    const declared = connector.tools()

    const discovered =
      options.discover && connector.discoverTools
        ? await discoverSafely(options, connection.connectorId, unavailable)
        : []

    for (const tool of [...declared, ...discovered]) {
      // Two independent gates, and both must pass: the workspace must actually
      // have the capability (it is in the connection's grant) and the department
      // must be allowed to use it.
      if (!connection.capabilities.includes(tool.capability)) continue
      if (!granted.has(tool.capability)) continue

      tools.push(wrap(tool, connection.connectorId, options))
    }
  }

  return { tools, names: tools.map((tool) => tool.name), unavailable }
}

/**
 * A failing MCP server must not stop the department from working.
 *
 * It is recorded as unavailable and the run continues without its tools — which is
 * the honest outcome, because the alternative is an agent that cannot do anything
 * because one optional integration is down.
 */
async function discoverSafely(
  options: ConnectorToolOptions,
  connectorId: string,
  unavailable: { connectorId: string; reason: string }[],
): Promise<ConnectorTool[]> {
  try {
    return await withClient(
      options.prisma,
      { workspaceId: options.workspaceId, connectorId, registry: options.registry },
      async (client) => {
        const connector = options.registry.require(connectorId)
        return (await connector.discoverTools?.(client as never)) ?? []
      },
    )
  } catch (error) {
    unavailable.push({
      connectorId,
      reason: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

function wrap(
  tool: ConnectorTool,
  connectorId: string,
  options: ConnectorToolOptions,
): NexusTool<z.ZodType> {
  return defineTool({
    name: tool.name,
    description: tool.description,
    // Identity mapping. A connector declaring `external` gets the external gate;
    // there is no translation layer that could soften it.
    risk: tool.risk,
    permission: PERMISSION_BY_CAPABILITY[tool.capability],
    inputSchema: tool.inputSchema,
    ...(tool.describe === undefined ? {} : { describe: (input: unknown) => tool.describe!(input) }),
    execute: async (input, context) =>
      withClient(
        context.prisma,
        { workspaceId: options.workspaceId, connectorId, registry: options.registry },
        (client) => tool.execute(input, client),
      ),
  })
}
