import { z } from 'zod'

import { defineConnector, type ConnectorTool } from '../connector'
import { request } from '../http'

/**
 * Google: Gmail and Calendar behind one connection.
 *
 * One connector rather than two, because they share a single OAuth grant — asking
 * the operator to authorise Google twice for one account is a worse experience and
 * produces two credentials that expire independently.
 *
 * Access tokens last an hour, so `connect` refreshes when needed. The refreshed
 * token is deliberately *not* written back: it would mean a write to the
 * credential table on nearly every use, and the refresh token — the thing that
 * actually matters — has not changed. The cost is one extra round trip per use.
 */

const credentialSchema = z.object({
  refreshToken: z.string().min(20),
  clientId: z.string().min(10),
  clientSecret: z.string().min(10),
  /** Cached access token, if one is still valid. */
  accessToken: z.string().optional(),
  accessTokenExpiresAt: z.number().optional(),
})

type Credential = z.infer<typeof credentialSchema>
interface Client {
  accessToken: string
  /** Address Gmail sends as, for the approval summary. */
  sendAs?: string | undefined
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const CALENDAR = 'https://www.googleapis.com/calendar/v3'
const TOKEN = 'https://oauth2.googleapis.com/token'

async function accessToken(credential: Credential): Promise<string> {
  const stillValid =
    credential.accessToken &&
    credential.accessTokenExpiresAt &&
    credential.accessTokenExpiresAt > Date.now() + 60_000

  if (stillValid && credential.accessToken) return credential.accessToken

  const body = new URLSearchParams({
    refresh_token: credential.refreshToken,
    client_id: credential.clientId,
    client_secret: credential.clientSecret,
    grant_type: 'refresh_token',
  })

  // Form-encoded, not JSON — the token endpoint rejects JSON, and the failure is
  // an opaque `invalid_request` that looks like a bad refresh token.
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    throw new Error(
      `Google refused to refresh the access token (${String(response.status)}). ` +
        `The refresh token may have been revoked — reauthorise the connection.`,
    )
  }

  const json = (await response.json()) as { access_token: string }
  return json.access_token
}

/** RFC 2822 message, base64url-encoded, which is what Gmail's send endpoint takes. */
function encodeMessage(params: { to: string; subject: string; body: string }): string {
  const message = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.body,
  ].join('\r\n')

  return Buffer.from(message, 'utf8').toString('base64url')
}

export const google = defineConnector<Credential, Client>({
  id: 'google',
  displayName: 'Google (Gmail & Calendar)',
  description: 'Read and send mail, read and write calendar events.',
  auth: 'oauth2',
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar',
  ],
  capabilities: ['email.read', 'email.send', 'calendar.read', 'calendar.write'],
  credentialSchema,

  connect: async (credential) => ({ accessToken: await accessToken(credential) }),

  healthCheck: async (value) => {
    try {
      const profile = await request<{ emailAddress: string }>(`${GMAIL}/profile`, {
        headers: { authorization: `Bearer ${value.accessToken}` },
      })
      return { ok: true, detail: `Authenticated as ${profile.emailAddress}.` }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        reauthorize: true,
      }
    }
  },

  tools: (): ConnectorTool[] => {
    /** Tools receive the client as `unknown`; narrowed here, once. */
    const auth = (value: unknown) => ({
      authorization: `Bearer ${(value as Client).accessToken}`,
    })

    return [
      {
        name: 'gmail.list',
        description:
          'List recent messages matching a Gmail search query, e.g. `is:unread newer_than:2d`. ' +
          'Returns subjects and senders, not full bodies.',
        risk: 'read',
        capability: 'email.read',
        inputSchema: z.object({
          query: z.string().default('is:unread'),
          limit: z.number().int().min(1).max(25).default(10),
        }),
        execute: async (raw, value) => {
          const input = z
            .object({ query: z.string().default('is:unread'), limit: z.number().default(10) })
            .parse(raw)

          const list = await request<{ messages?: { id: string }[] }>(`${GMAIL}/messages`, {
            headers: auth(value),
            query: { q: input.query, maxResults: input.limit },
          })

          const ids = (list.messages ?? []).map((message) => message.id)

          // Sequential rather than parallel: Gmail rate-limits per user, and a
          // burst of 25 concurrent reads is the reliable way to get a 429.
          const messages = []
          for (const id of ids) {
            const detail = await request<{
              snippet: string
              payload: { headers: { name: string; value: string }[] }
            }>(`${GMAIL}/messages/${id}`, {
              headers: auth(value),
              query: { format: 'metadata' },
            })

            const header = (name: string) =>
              detail.payload.headers.find((h) => h.name.toLowerCase() === name)?.value ?? ''

            messages.push({
              id,
              from: header('from'),
              subject: header('subject'),
              date: header('date'),
              snippet: detail.snippet,
            })
          }

          return { count: messages.length, messages }
        },
      },
      {
        name: 'gmail.send',
        description:
          'Send an email. Requires approval — it leaves from the operator’s own address and ' +
          'cannot be recalled.',
        risk: 'external',
        capability: 'email.send',
        inputSchema: z.object({
          to: z.email(),
          subject: z.string().min(1).max(300),
          body: z.string().min(1),
        }),
        describe: (raw) => {
          const input = z
            .object({ to: z.string(), subject: z.string(), body: z.string() })
            .parse(raw)
          return {
            title: `Email ${input.to}: ${input.subject}`,
            summary: `${input.body.slice(0, 800)}\n\nSent from your own address. Not recallable.`,
          }
        },
        execute: async (raw, value) => {
          const input = z
            .object({ to: z.string(), subject: z.string(), body: z.string() })
            .parse(raw)

          const sent = await request<{ id: string }>(`${GMAIL}/messages/send`, {
            method: 'POST',
            headers: auth(value),
            body: { raw: encodeMessage(input) },
          })

          return { messageId: sent.id, to: input.to }
        },
      },
      {
        name: 'gcal.list',
        description: 'List calendar events in a window.',
        risk: 'read',
        capability: 'calendar.read',
        inputSchema: z.object({
          days: z.number().int().min(1).max(60).default(7),
          calendarId: z.string().default('primary'),
        }),
        execute: async (raw, value) => {
          const input = z
            .object({ days: z.number().default(7), calendarId: z.string().default('primary') })
            .parse(raw)

          const events = await request<{
            items: {
              id: string
              summary?: string
              start: { dateTime?: string; date?: string }
              end: { dateTime?: string; date?: string }
              attendees?: { email: string }[]
            }[]
          }>(`${CALENDAR}/calendars/${encodeURIComponent(input.calendarId)}/events`, {
            headers: auth(value),
            query: {
              timeMin: new Date().toISOString(),
              timeMax: new Date(Date.now() + input.days * 86_400_000).toISOString(),
              singleEvents: true,
              orderBy: 'startTime',
              maxResults: 50,
            },
          })

          return {
            count: events.items.length,
            events: events.items.map((event) => ({
              id: event.id,
              title: event.summary ?? '(no title)',
              start: event.start.dateTime ?? event.start.date ?? null,
              end: event.end.dateTime ?? event.end.date ?? null,
              attendees: event.attendees?.length ?? 0,
            })),
          }
        },
      },
      {
        name: 'gcal.create',
        description:
          'Create a calendar event. Requires approval when there are attendees, because it ' +
          'sends them an invitation.',
        risk: 'external',
        capability: 'calendar.write',
        inputSchema: z.object({
          calendarId: z.string().default('primary'),
          title: z.string().min(1).max(300),
          startsAt: z.string().datetime(),
          endsAt: z.string().datetime(),
          attendees: z.array(z.email()).default([]),
          description: z.string().max(2000).optional(),
        }),
        describe: (raw) => {
          const input = z
            .object({ title: z.string(), attendees: z.array(z.string()).default([]) })
            .parse(raw)
          return {
            title: `Create "${input.title}"`,
            summary:
              input.attendees.length > 0
                ? `Invites ${input.attendees.join(', ')}. Their calendars are the outside world.`
                : 'No attendees — this only blocks the operator’s own time.',
          }
        },
        execute: async (raw, value) => {
          const input = z
            .object({
              calendarId: z.string().default('primary'),
              title: z.string(),
              startsAt: z.string(),
              endsAt: z.string(),
              attendees: z.array(z.string()).default([]),
              description: z.string().optional(),
            })
            .parse(raw)

          const created = await request<{ id: string; htmlLink: string }>(
            `${CALENDAR}/calendars/${encodeURIComponent(input.calendarId)}/events`,
            {
              method: 'POST',
              headers: auth(value),
              query: { sendUpdates: input.attendees.length > 0 ? 'all' : 'none' },
              body: {
                summary: input.title,
                start: { dateTime: input.startsAt },
                end: { dateTime: input.endsAt },
                attendees: input.attendees.map((email) => ({ email })),
                ...(input.description === undefined ? {} : { description: input.description }),
              },
            },
          )

          return { eventId: created.id, url: created.htmlLink }
        },
      },
    ]
  },
})
