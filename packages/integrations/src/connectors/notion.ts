import { z } from 'zod'

import { defineConnector, type ConnectorTool } from '../connector'
import { request } from '../http'

/**
 * Notion.
 *
 * Reading is `read`. Writing a page is `internal`, not `external` — a Notion
 * workspace belongs to the operator, so a page created there is inside the
 * system's blast radius in the way that a tweet is not. That is a judgment call
 * and it is written down here rather than left implicit, because it is exactly the
 * kind of line that gets moved by accident later.
 */

const credentialSchema = z.object({
  /** Internal integration token, `ntn_…` or the older `secret_…`. */
  token: z.string().min(20),
})

type Credential = z.infer<typeof credentialSchema>
interface Client {
  token: string
}

const API = 'https://api.notion.com/v1'

/** Tools receive the client as `unknown`; this is the one place it is narrowed. */
function client(value: unknown): Client {
  return value as Client
}

function headers(value: Client): Record<string, string> {
  return {
    authorization: `Bearer ${value.token}`,
    'notion-version': '2022-06-28',
  }
}

/** Notion returns rich text as an array of runs; this is the readable form. */
function plainText(runs: { plain_text?: string }[] | undefined): string {
  return (runs ?? []).map((run) => run.plain_text ?? '').join('')
}

export const notion = defineConnector<Credential, Client>({
  id: 'notion',
  displayName: 'Notion',
  description: 'Search the workspace, read pages, and append notes.',
  auth: 'apikey',
  scopes: [],
  capabilities: ['docs.read', 'docs.write'],
  credentialSchema,

  connect: (credential) => Promise.resolve({ token: credential.token }),

  healthCheck: async (value) => {
    try {
      await request(`${API}/users/me`, { headers: headers(value) })
      return { ok: true }
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
      name: 'notion.search',
      description:
        'Search Notion. Only pages explicitly shared with the integration are visible — if ' +
        'something is missing, it has not been shared, not deleted.',
      risk: 'read',
      capability: 'docs.read',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      execute: async (raw, value) => {
        const input = z.object({ query: z.string(), limit: z.number().default(10) }).parse(raw)

        const results = await request<{
          results: {
            id: string
            object: string
            url?: string
            properties?: Record<string, { title?: { plain_text?: string }[] }>
          }[]
        }>(`${API}/search`, {
          method: 'POST',
          headers: headers(client(value)),
          body: { query: input.query, page_size: input.limit },
        })

        return {
          count: results.results.length,
          pages: results.results.map((page) => ({
            id: page.id,
            type: page.object,
            url: page.url ?? null,
            title:
              Object.values(page.properties ?? {})
                .map((property) => plainText(property.title))
                .find((title) => title.length > 0) ?? '(untitled)',
          })),
        }
      },
    },
    {
      name: 'notion.page.read',
      description: 'Read a page’s text content, block by block.',
      risk: 'read',
      capability: 'docs.read',
      inputSchema: z.object({ pageId: z.string().min(30) }),
      execute: async (raw, value) => {
        const input = z.object({ pageId: z.string() }).parse(raw)

        const blocks = await request<{
          results: { type: string; [key: string]: unknown }[]
        }>(`${API}/blocks/${input.pageId}/children`, {
          headers: headers(client(value)),
          query: { page_size: 100 },
        })

        const text = blocks.results
          .map((block) => {
            const content = block[block.type] as
              { rich_text?: { plain_text?: string }[] } | undefined
            return plainText(content?.rich_text)
          })
          .filter((line) => line.length > 0)

        return { blocks: blocks.results.length, text: text.join('\n') }
      },
    },
    {
      name: 'notion.page.append',
      description:
        'Append paragraphs to an existing page. Appends only — this tool cannot overwrite ' +
        'anything the operator wrote.',
      risk: 'internal',
      capability: 'docs.write',
      inputSchema: z.object({
        pageId: z.string().min(30),
        paragraphs: z.array(z.string().min(1)).min(1).max(50),
      }),
      execute: async (raw, value) => {
        const input = z.object({ pageId: z.string(), paragraphs: z.array(z.string()) }).parse(raw)

        await request(`${API}/blocks/${input.pageId}/children`, {
          method: 'PATCH',
          headers: headers(client(value)),
          body: {
            children: input.paragraphs.map((paragraph) => ({
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: paragraph } }] },
            })),
          },
        })

        return { appended: input.paragraphs.length }
      },
    },
  ],
})
