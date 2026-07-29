import { recall, routerFromEnv } from '@nexusai/agents'
import { assert } from '@nexusai/core'
import { prisma, type memory as memoryRepo } from '@nexusai/db'
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@nexusai/ui'
import { format } from 'date-fns'
import { BrainIcon, SearchIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Memory' }

/**
 * The memory browser.
 *
 * Searching here uses exactly the same hybrid retrieval the agents use, not a
 * simplified version. If the operator cannot reproduce what an agent saw, they
 * cannot judge whether it read the right thing — and the fused ranks are shown
 * for the same reason.
 */
export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { actor, workspace } = await requireSession()
  assert(actor, 'memory:read', { workspaceId: workspace.id })

  const { q } = await searchParams
  const query = q?.trim() ?? ''

  const [documents, stats] = await Promise.all([
    prisma.memoryDocument.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        title: true,
        kind: true,
        scopes: true,
        createdAt: true,
        ingestedAt: true,
        _count: { select: { chunks: true } },
      },
    }),
    prisma.$queryRaw<{ chunks: bigint; embedded: bigint }[]>`
      SELECT count(*) AS chunks, count(embedding) AS embedded
      FROM memory_chunk WHERE workspace_id = ${workspace.id}::uuid
    `,
  ])

  const results = query === '' ? [] : await search(workspace.id, query)

  const totalChunks = Number(stats[0]?.chunks ?? 0)
  const embedded = Number(stats[0]?.embedded ?? 0)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="text-sm text-muted-foreground">
          Everything the company knows, searched the same way the agents search it — exact terms and
          meaning fused together.
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {documents.length} documents · {totalChunks} chunks · {embedded} embedded
          {embedded < totalChunks ? ' · run the backfill to embed the rest' : ''}
        </p>
      </header>

      <form className="flex gap-2" action="/memory">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-input px-3 focus-within:ring-ring">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            name="q"
            defaultValue={query}
            placeholder="What did we decide about…"
            aria-label="Search memory"
            className="h-9 w-full bg-transparent text-sm outline-none"
          />
        </div>
      </form>

      {query !== '' ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            {results.length} results for &ldquo;{query}&rdquo;
          </h2>

          {results.length === 0 ? (
            <div className="rounded-xl border border-border">
              <EmptyState
                icon={BrainIcon}
                title="Nothing matched"
                description="Try different words. Semantic search finds paraphrase, but it cannot find what was never written down."
              />
            </div>
          ) : (
            results.map((result) => (
              <Card key={result.id}>
                <CardHeader className="gap-1 pb-2">
                  <CardTitle className="text-sm">
                    {result.headings.length > 0 ? result.headings.join(' › ') : 'Untitled section'}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                    <span>score {result.score.toFixed(4)}</span>
                    {/* Showing which signal found it is the honest version of a
                        relevance number: "keyword only" and "both" mean
                        different things about how much to trust the hit. */}
                    <Badge variant={result.ftsRank === null ? 'outline' : 'accent'}>
                      {result.ftsRank === null
                        ? 'meaning only'
                        : result.semanticRank === null
                          ? 'exact term only'
                          : 'both signals'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{result.content}</p>
                </CardContent>
              </Card>
            ))
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
          Documents
        </h2>

        {documents.length === 0 ? (
          <div className="rounded-xl border border-border">
            <EmptyState
              icon={BrainIcon}
              title="Memory is empty"
              description="Drop markdown into packages/db/prisma/seed/memory/ and run pnpm db:seed, or tell a department something worth remembering."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {documents.map((document) => (
              <li key={document.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm">{document.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {document.kind} · {document._count.chunks} chunks ·{' '}
                    {format(document.createdAt, 'd MMM')}
                    {document.ingestedAt === null ? ' · not yet chunked' : ''}
                  </span>
                </div>
                {document.scopes.map((scope) => (
                  <Badge key={scope} variant="outline">
                    {scope}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Chunks are cited by the runs that used them.{' '}
        <Link href="/" className="underline underline-offset-2">
          Back to the dashboard
        </Link>
      </p>
    </div>
  )
}

async function search(workspaceId: string, query: string) {
  try {
    return await recall({
      prisma,
      router: routerFromEnv(),
      workspaceId,
      query,
      // No scope filter: the operator sees everything, unlike a department.
      scopes: [],
      limit: 10,
    })
  } catch {
    // A search that fails must not take the page down — the document list below
    // is still useful, and the empty result reads as "nothing matched".
    return [] as Awaited<ReturnType<typeof memoryRepo.hybridSearch>>
  }
}
