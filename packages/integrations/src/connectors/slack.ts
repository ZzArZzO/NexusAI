import { createHmac } from 'node:crypto'

import { z } from 'zod'

import { defineConnector, type ConnectorTool } from '../connector'
import { safeEqual } from '../crypto'
import { request } from '../http'
import { withinTolerance } from '../webhook'

/**
 * Slack.
 *
 * Reading a channel is `read`; posting is `external`. Slack is the case where
 * "internal tool, low risk" is most tempting and most wrong — a message in a
 * shared channel is seen by colleagues and cannot be unsent in any way that
 * matters.
 */

const credentialSchema = z.object({
  /** Bot token, `xoxb-…`. */
  botToken: z.string().startsWith('xoxb-'),
})

type Credential = z.infer<typeof credentialSchema>
interface Client {
  botToken: string
  defaultChannel?: string | undefined
}

const API = 'https://slack.com/api'

/** Tools receive the client as `unknown`; this is the one place it is narrowed. */
function client(value: unknown): Client {
  return value as Client
}

function headers(value: Client): Record<string, string> {
  return { authorization: `Bearer ${value.botToken}` }
}

/**
 * Slack returns HTTP 200 with `{ ok: false, error }` on failure, so the HTTP
 * layer's status check cannot see it. Every call goes through here instead.
 */
async function call<T>(
  value: Client,
  method: string,
  options: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const response = await request<{ ok: boolean; error?: string } & T>(`${API}/${method}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: headers(value),
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.query === undefined ? {} : { query: options.query }),
  })

  if (!response.ok) {
    throw new Error(`Slack ${method} failed: ${response.error ?? 'unknown error'}`)
  }

  return response
}

export const slack = defineConnector<Credential, Client>({
  id: 'slack',
  displayName: 'Slack',
  description: 'Read channels and post messages.',
  auth: 'oauth2',
  scopes: ['channels:history', 'channels:read', 'chat:write'],
  capabilities: ['chat.read', 'chat.send'],
  credentialSchema,
  configSchema: z.object({ defaultChannel: z.string().optional() }),

  connect: (credential, config) => {
    const parsed = z.object({ defaultChannel: z.string().optional() }).safeParse(config ?? {})
    return Promise.resolve({
      botToken: credential.botToken,
      defaultChannel: parsed.success ? parsed.data.defaultChannel : undefined,
    })
  },

  healthCheck: async (value) => {
    try {
      const auth = await call<{ team?: string }>(value, 'auth.test')
      return auth.team ? { ok: true, detail: `Connected to ${auth.team}.` } : { ok: true }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        reauthorize: true,
      }
    }
  },

  tools: (): ConnectorTool[] => [
    {
      name: 'slack.history',
      description: 'Read recent messages in a channel.',
      risk: 'read',
      capability: 'chat.read',
      inputSchema: z.object({
        channel: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (raw, value) => {
        const input = z
          .object({ channel: z.string().optional(), limit: z.number().default(20) })
          .parse(raw)
        const channel = input.channel ?? client(value).defaultChannel
        if (!channel) return { error: 'No channel given and no default configured.' }

        const history = await call<{ messages: { user?: string; text?: string; ts: string }[] }>(
          client(value),
          'conversations.history',
          { query: { channel, limit: input.limit } },
        )

        return {
          count: history.messages.length,
          messages: history.messages.map((message) => ({
            user: message.user ?? 'unknown',
            text: message.text ?? '',
            at: new Date(Number(message.ts) * 1000).toISOString(),
          })),
        }
      },
    },
    {
      name: 'slack.post',
      description: 'Post a message to a channel. Requires approval — other people read it.',
      risk: 'external',
      capability: 'chat.send',
      inputSchema: z.object({ channel: z.string().optional(), text: z.string().min(1) }),
      describe: (raw) => {
        const input = z.object({ channel: z.string().optional(), text: z.string() }).parse(raw)
        return {
          title: `Post to ${input.channel ?? 'the default Slack channel'}`,
          summary: `"${input.text.slice(0, 300)}"\n\nThis is visible to everyone in the channel.`,
        }
      },
      execute: async (raw, value) => {
        const input = z.object({ channel: z.string().optional(), text: z.string() }).parse(raw)
        const channel = input.channel ?? client(value).defaultChannel
        if (!channel) return { error: 'No channel given and no default configured.' }

        const posted = await call<{ ts: string }>(client(value), 'chat.postMessage', {
          body: { channel, text: input.text },
        })

        return { ts: posted.ts, channel }
      },
    },
  ],

  /**
   * Slack's v0 scheme: HMAC-SHA256 over `v0:<timestamp>:<rawBody>`.
   *
   * The timestamp is in its own header rather than inside the signature, and
   * checking it is the only thing preventing replay — Slack's own documentation
   * calls this out, and it is still the most commonly skipped step.
   */
  verifyWebhook: (req, secret) => {
    const timestamp = req.headers['x-slack-request-timestamp'] ?? ''
    const signature = req.headers['x-slack-signature'] ?? ''

    const eventId = /"event_id"\s*:\s*"([^"]+)"/.exec(req.rawBody)?.[1] ?? `slack-${timestamp}`
    const eventType = /"type"\s*:\s*"([^"]+)"/.exec(req.rawBody)?.[1] ?? 'unknown'

    if (!timestamp || !withinTolerance(Number(timestamp))) {
      return { externalId: eventId, eventType, signatureOk: false }
    }

    const expected = `v0=${createHmac('sha256', secret)
      .update(`v0:${timestamp}:${req.rawBody}`, 'utf8')
      .digest('hex')}`

    return { externalId: eventId, eventType, signatureOk: safeEqual(expected, signature) }
  },
})
