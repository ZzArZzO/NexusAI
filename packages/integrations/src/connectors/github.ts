import { z } from 'zod'

import { defineConnector, type ConnectorTool } from '../connector'
import { request } from '../http'
import { verifyHmac } from '../webhook'

/**
 * GitHub.
 *
 * Reading a repository or a diff is `read`. Posting a comment or a review is
 * `external` — it appears publicly under the operator's account. Nothing here
 * writes code, merges, or pushes: those need a much narrower discussion than a
 * connector can have, and a token that can force-push is not a token to hand an
 * agent by default.
 */

const credentialSchema = z.object({
  /** Fine-grained PAT or an OAuth access token. */
  token: z.string().min(20),
})

type Credential = z.infer<typeof credentialSchema>

interface Client {
  token: string
  defaultRepo?: string | undefined
}

const API = 'https://api.github.com'
const configSchema = z.object({ defaultRepo: z.string().optional() })

function client(value: unknown): Client {
  return value as Client
}

function headers(value: Client): Record<string, string> {
  return {
    authorization: `Bearer ${value.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  }
}

/** The repo to act on: explicit argument, else the connection's default. */
function repoOf(input: { repo?: string | undefined }, value: Client): string | undefined {
  return input.repo ?? value.defaultRepo
}

export const github = defineConnector<Credential, Client>({
  id: 'github',
  displayName: 'GitHub',
  description: 'Read repositories and pull requests; draft and post reviews.',
  auth: 'apikey',
  scopes: ['repo:read', 'pull_request:write'],
  capabilities: ['repo.read', 'repo.write'],
  credentialSchema,
  configSchema,

  connect: (credential, config) => {
    const parsed = configSchema.safeParse(config ?? {})
    return Promise.resolve({
      token: credential.token,
      defaultRepo: parsed.success ? parsed.data.defaultRepo : undefined,
    })
  },

  healthCheck: async (value) => {
    try {
      const user = await request<{ login: string }>(`${API}/user`, { headers: headers(value) })
      return { ok: true, detail: `Authenticated as ${user.login}.` }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: message, reauthorize: message.includes('401') }
    }
  },

  tools: (): ConnectorTool[] => [
    {
      name: 'github.pr.list',
      description: 'List open pull requests on a repository.',
      risk: 'read',
      capability: 'repo.read',
      inputSchema: z.object({
        repo: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/)
          .optional(),
        state: z.enum(['open', 'closed', 'all']).default('open'),
      }),
      execute: async (raw, value) => {
        const input = z
          .object({ repo: z.string().optional(), state: z.string().default('open') })
          .parse(raw)
        const github = client(value)
        const repo = repoOf(input, github)
        if (!repo) return { error: 'No repository given and no default configured.' }

        const pulls = await request<
          { number: number; title: string; user: { login: string }; draft: boolean }[]
        >(`${API}/repos/${repo}/pulls`, {
          headers: headers(github),
          query: { state: input.state, per_page: 20 },
        })

        return {
          count: pulls.length,
          pulls: pulls.map((pull) => ({
            number: pull.number,
            title: pull.title,
            author: pull.user.login,
            draft: pull.draft,
          })),
        }
      },
    },
    {
      name: 'github.pr.diff',
      description: 'Read the diff of a pull request. Read this before reviewing it.',
      risk: 'read',
      capability: 'repo.read',
      inputSchema: z.object({ repo: z.string().optional(), number: z.number().int().positive() }),
      execute: async (raw, value) => {
        const input = z.object({ repo: z.string().optional(), number: z.number() }).parse(raw)
        const github = client(value)
        const repo = repoOf(input, github)
        if (!repo) return { error: 'No repository given and no default configured.' }

        const files = await request<
          { filename: string; additions: number; deletions: number; patch?: string }[]
        >(`${API}/repos/${repo}/pulls/${String(input.number)}/files`, {
          headers: headers(github),
          query: { per_page: 100 },
        })

        return {
          files: files.length,
          // Patches are truncated per file. A model given 40 full patches spends
          // its whole context on the diff and has none left to reason about it.
          changes: files.map((file) => ({
            file: file.filename,
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch?.slice(0, 6000) ?? null,
          })),
        }
      },
    },
    {
      name: 'github.pr.comment',
      description:
        'Post a review comment on a pull request. Requires approval — it is public and ' +
        'attributed to the operator.',
      risk: 'external',
      capability: 'repo.write',
      inputSchema: z.object({
        repo: z.string().optional(),
        number: z.number().int().positive(),
        body: z.string().min(10),
      }),
      describe: (raw) => {
        const input = z.object({ number: z.number(), repo: z.string().optional() }).parse(raw)
        return {
          title: `Comment on PR #${String(input.number)}`,
          summary:
            `This posts publicly on ${input.repo ?? 'the default repository'} under your GitHub ` +
            `account and cannot be unseen once notified.`,
        }
      },
      execute: async (raw, value) => {
        const input = z
          .object({ repo: z.string().optional(), number: z.number(), body: z.string() })
          .parse(raw)
        const github = client(value)
        const repo = repoOf(input, github)
        if (!repo) return { error: 'No repository given and no default configured.' }

        const comment = await request<{ id: number; html_url: string }>(
          `${API}/repos/${repo}/issues/${String(input.number)}/comments`,
          { method: 'POST', headers: headers(github), body: { body: input.body } },
        )

        return { commentId: comment.id, url: comment.html_url }
      },
    },
  ],

  /**
   * GitHub signs the raw body with HMAC-SHA256 and sends `sha256=<hex>`.
   *
   * The delivery id doubles as the deduplication key, which is exactly what it is
   * for — GitHub retries a delivery with the same id.
   */
  verifyWebhook: (req, secret) => ({
    externalId: req.headers['x-github-delivery'] ?? 'missing-delivery-id',
    eventType: req.headers['x-github-event'] ?? 'unknown',
    signatureOk: verifyHmac({
      signedPayload: req.rawBody,
      secret,
      signature: req.headers['x-hub-signature-256'] ?? '',
      prefix: 'sha256=',
    }),
  }),
})
