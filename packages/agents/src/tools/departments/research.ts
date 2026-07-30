import { generateText } from 'ai'
import { z } from 'zod'

import type { ModelRouter } from '../../models/router'
import { defineTool, type NexusTool } from '../registry'

/**
 * Research tools.
 *
 * Web search is `read` — it changes nothing outside the system. It does cost
 * money per search, which is why the tool reports how many it performed rather
 * than hiding it, and why the count is capped.
 */

export interface ResearchToolOptions {
  router: ModelRouter
}

export function createResearchTools(options: ResearchToolOptions): NexusTool<z.ZodType>[] {
  const { router } = options

  const webSearch = defineTool({
    name: 'web.search',
    description:
      'Search the web for current information. Use this for anything time-sensitive, any claim ' +
      'about a competitor or a market, and anything long-term memory does not already answer. ' +
      'Always report the date you found something.',
    risk: 'read',
    permission: 'memory:read',
    inputSchema: z.object({
      query: z.string().min(3),
      /** Kept small on purpose: each search is billed, and ten mediocre results
       *  are worse than three good ones for a model that has to read them. */
      maxResults: z.number().int().min(1).max(5).default(3),
    }),
    execute: async (input) => {
      if (!router.live) {
        // Honest rather than empty: an agent told "no results" will conclude the
        // thing does not exist, which is a different and worse answer.
        return {
          available: false as const,
          searches: 0,
          message:
            'No search provider is configured, because no ANTHROPIC_API_KEY is set. ' +
            'Say that you could not search rather than answering from guesswork.',
          results: [],
        }
      }

      const { model } = router.language('bulk')

      /**
       * Search runs through the model provider's own server-side tool rather than
       * a scraping layer of our own. It handles fetching, extraction and freshness,
       * and its results arrive already attributed — which matters because the
       * charters require Research to cite what it read.
       */
      const result = await generateText({
        model,
        prompt:
          `Search the web for: ${input.query}\n\n` +
          `Return the ${input.maxResults} most useful results. For each: the title, the URL, ` +
          `the publication date if you can find one, and two sentences on what it actually says. ` +
          `Do not summarise across sources — keep them separate so each claim keeps its origin.`,
        tools: {
          web_search: {
            type: 'provider-defined',
            id: 'anthropic.web_search',
            name: 'web_search',
            args: { max_uses: input.maxResults },
          } as never,
        },
      })

      const searches = (result.providerMetadata?.['anthropic'] as { webSearchRequests?: number })
        ?.webSearchRequests

      return {
        available: true as const,
        // Surfaced so the cost of research is visible in the run timeline rather
        // than buried in a monthly bill.
        searches: searches ?? input.maxResults,
        findings: result.text,
      }
    },
  })

  const recordSource = defineTool({
    name: 'source.record',
    description:
      'Record a source you actually read, with the date. Do this for every claim that came from ' +
      'outside — a dead link later must not erase the evidence.',
    risk: 'internal',
    permission: 'memory:create',
    inputSchema: z.object({
      url: z.url(),
      title: z.string().max(300).optional(),
      excerpt: z
        .string()
        .max(4000)
        .optional()
        .describe('The part you relied on, quoted. Not your summary of it.'),
      reportId: z.uuid().optional(),
    }),
    execute: async (input, context) => {
      const source = await context.prisma.source.create({
        data: {
          workspaceId: context.workspaceId,
          url: input.url,
          retrievedAt: new Date(),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
          ...(input.reportId === undefined ? {} : { reportId: input.reportId }),
        },
        select: { id: true },
      })

      return { sourceId: source.id, url: input.url }
    },
  })

  const listSources = defineTool({
    name: 'source.list',
    description:
      'List sources already recorded. Check here before searching again — re-reading something ' +
      'the company already read is wasted money.',
    risk: 'read',
    permission: 'memory:read',
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
    execute: async (input, context) => {
      const sources = await context.prisma.source.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: { retrievedAt: 'desc' },
        take: input.limit,
        select: { id: true, url: true, title: true, retrievedAt: true },
      })

      return {
        count: sources.length,
        sources: sources.map((source) => ({
          ...source,
          retrievedAt: source.retrievedAt.toISOString().slice(0, 10),
        })),
      }
    },
  })

  return [webSearch, recordSource, listSources] as NexusTool<z.ZodType>[]
}
