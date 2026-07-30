import { z } from 'zod'

import { defineConnector, type ConnectorTool, type ConnectorToolRisk } from '../connector'
import { request } from '../http'

/**
 * MCP servers as a connector type.
 *
 * This is the extensibility escape hatch: any MCP server the operator points at
 * contributes its tools to the company without a line of code being written. It
 * is also the one connector whose tools are not known until runtime, which forces
 * two decisions that would otherwise be easy to get wrong.
 *
 * **1. Remote tools default to `external`.**
 *
 * We cannot inspect what a remote tool does. A tool called `search_docs` might
 * post to a webhook. Treating unknown as safe would mean the gate — the single
 * property that makes autonomy tolerable here — could be bypassed by adding an
 * MCP server. So unknown means gated, and the operator lowers a specific tool's
 * tier by hand once they know what it does. That is deliberately more friction
 * than the alternative, in the one place friction is worth paying for.
 *
 * **2. Tool names are namespaced.**
 *
 * `mcp.<server>.<tool>`, because two MCP servers will eventually both expose
 * `search`, and a collision in the registry would silently give one server's
 * traffic to the other.
 */

const credentialSchema = z.object({
  /** Streamable HTTP endpoint of the MCP server. */
  url: z.url(),
  /** Optional bearer token, for servers that require auth. */
  token: z.string().optional(),
  /** Short slug used to namespace this server's tools: `mcp.<slug>.<tool>`. */
  slug: z
    .string()
    .regex(/^[a-z0-9-]{2,32}$/, 'Lowercase letters, digits and hyphens; 2-32 characters.'),
  /**
   * Tools the operator has reviewed and re-tiered, e.g. `{ "search": "read" }`.
   * Anything absent stays `external`.
   */
  riskOverrides: z
    .record(z.string(), z.enum(['read', 'internal', 'external', 'financial']))
    .default({}),
})

type Credential = z.infer<typeof credentialSchema>

interface Client {
  url: string
  slug: string
  headers: Record<string, string>
  riskOverrides: Record<string, ConnectorToolRisk>
}

interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/**
 * One JSON-RPC call over MCP's streamable HTTP transport.
 *
 * Deliberately hand-rolled rather than pulling in a client library: this needs
 * exactly two methods (`tools/list`, `tools/call`), and the value of not adding a
 * dependency that can reach the network on import is higher than the value of the
 * abstraction.
 */
async function rpc<T>(client: Client, method: string, params?: unknown): Promise<T> {
  const response = await request<{ result?: T; error?: { code: number; message: string } }>(
    client.url,
    {
      method: 'POST',
      headers: {
        ...client.headers,
        accept: 'application/json, text/event-stream',
      },
      body: { jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) },
      timeoutMs: 30_000,
    },
  )

  if (response.error) {
    throw new Error(`MCP ${method} failed: ${response.error.message}`)
  }

  if (response.result === undefined) {
    // An RPC response with neither result nor error is a broken server. Returning
    // undefined here would surface as a confusing type error later instead.
    throw new Error(`MCP ${method} returned neither a result nor an error.`)
  }

  return response.result
}

export const mcp = defineConnector<Credential, Client>({
  id: 'mcp',
  displayName: 'MCP server',
  description:
    'Any Model Context Protocol server. Its tools become available to departments granted ' +
    'mcp.tools, gated as external until you review them.',
  auth: 'apikey',
  scopes: [],
  capabilities: ['mcp.tools'],
  credentialSchema,

  connect: (credential) => {
    // Built by assignment rather than by a conditional spread: a ternary produces
    // `{ authorization?: undefined }` on one branch, which is not a
    // `Record<string, string>` in packages that do not enable
    // exactOptionalPropertyTypes — and this type crosses that boundary.
    const headers: Record<string, string> = {}
    if (credential.token) headers['authorization'] = `Bearer ${credential.token}`

    return Promise.resolve({
      url: credential.url,
      slug: credential.slug,
      headers,
      riskOverrides: credential.riskOverrides,
    })
  },

  healthCheck: async (value) => {
    try {
      const listed = await rpc<{ tools: McpTool[] }>(value, 'tools/list')
      return { ok: true, detail: `${String(listed.tools.length)} tools available.` }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        reauthorize: false,
      }
    }
  },

  /**
   * Nothing is known statically. Every MCP tool comes from `discoverTools`, which
   * is the reason that hook exists at all.
   */
  tools: () => [],

  discoverTools: async (client): Promise<ConnectorTool[]> => {
    const listed = await rpc<{ tools: McpTool[] }>(client, 'tools/list')

    return listed.tools.map((tool) => ({
      name: `mcp.${client.slug}.${tool.name}`,
      description:
        `${tool.description ?? 'No description provided by the server.'} ` +
        `(From the ${client.slug} MCP server.)`,
      // Unknown means gated. See the note at the top of this file.
      risk: client.riskOverrides[tool.name] ?? 'external',
      capability: 'mcp.tools',
      /**
       * The server's own JSON Schema is not translated into Zod. It is passed
       * through as an opaque object and validated by the server, because a
       * lossy translation here would reject valid calls — and silently narrowing
       * a remote tool's inputs is worse than not validating them locally.
       */
      inputSchema: z.record(z.string(), z.unknown()),
      describe: (input) => ({
        title: `Run ${client.slug}/${tool.name}`,
        summary:
          `${tool.description ?? 'The server gave no description.'}\n\n` +
          `This runs on a remote MCP server (${client.url}) whose behaviour we cannot inspect. ` +
          `Arguments: ${JSON.stringify(input).slice(0, 600)}`,
      }),
      execute: async (input) => {
        const result = await rpc<{
          content?: { type: string; text?: string }[]
          isError?: boolean
        }>(client, 'tools/call', { name: tool.name, arguments: input })

        if (result.isError) {
          return {
            status: 'failed' as const,
            error:
              result.content?.map((part) => part.text ?? '').join('\n') ?? 'Unknown MCP error.',
          }
        }

        return {
          content: (result.content ?? [])
            .map((part) => (part.type === 'text' ? part.text : `[${part.type}]`))
            .join('\n'),
        }
      },
    }))
  },
})
