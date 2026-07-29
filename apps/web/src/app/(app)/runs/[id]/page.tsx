import { formatMicros } from '@nexusai/agents'
import { prisma, runs as runRepo } from '@nexusai/db'
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@nexusai/ui'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Run' }

/**
 * The run timeline.
 *
 * This page is the answer to "why did it say that". Every step, every tool call
 * with its real input and output, and the exact memory chunks the step was
 * given — reachable in one click from anything the system produced.
 */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { workspace } = await requireSession()

  const run = await runRepo.findRunTimeline(prisma, id)

  // Ownership is proven, not assumed. The id came from a URL.
  if (run?.workspaceId !== workspace.id) notFound()

  const citedIds = [...new Set(run.steps.flatMap((step) => step.citedChunkIds))]

  const chunks =
    citedIds.length > 0
      ? await prisma.memoryChunk.findMany({
          where: { id: { in: citedIds } },
          select: {
            id: true,
            content: true,
            headings: true,
            document: { select: { title: true } },
          },
        })
      : []

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/departments/${run.department.key}`}
          className="w-fit font-mono text-[0.65rem] tracking-[0.16em] text-muted-foreground uppercase hover:underline"
        >
          {run.department.displayName}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{run.objective ?? 'Untitled run'}</h1>
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
          <Badge
            variant={
              run.status === 'failed'
                ? 'danger'
                : run.status === 'succeeded'
                  ? 'success'
                  : 'warning'
            }
          >
            {run.status}
          </Badge>
          <span>{run.trigger}</span>
          <span>{format(run.startedAt, 'd MMM HH:mm:ss')}</span>
          {run.durationMs === null ? null : <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
          <span>
            {run.inputTokens.toLocaleString('en-GB')} in /{' '}
            {run.outputTokens.toLocaleString('en-GB')} out
          </span>
          <span>{formatMicros(run.costMicros)}</span>
        </div>
      </header>

      {run.error ? (
        <p className="border-l-2 border-destructive/60 pl-3 text-sm text-destructive">
          {run.error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
          Steps
        </h2>

        <ol className="flex flex-col gap-3">
          {run.steps.map((step) => (
            <li key={step.id}>
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
                  <CardTitle className="text-sm font-medium">
                    <span className="mr-2 font-mono text-muted-foreground">{step.index + 1}</span>
                    {step.summary ?? 'Step'}
                  </CardTitle>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {step.model ?? '—'}
                  </span>
                </CardHeader>

                <CardContent className="flex flex-col gap-3 pt-0">
                  {step.toolCalls.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {step.toolCalls.map((call) => (
                        <ToolCallRow key={call.id} call={call} />
                      ))}
                    </ul>
                  ) : null}

                  {step.citedChunkIds.length > 0 ? (
                    <details className="flex flex-col gap-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        {step.citedChunkIds.length} memory chunks given to this step
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                        {step.citedChunkIds.map((chunkId) => {
                          const chunk = chunkById.get(chunkId)
                          return (
                            <div
                              key={chunkId}
                              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
                            >
                              <p className="mb-1 font-mono text-muted-foreground">
                                {chunk?.document.title ?? 'Deleted document'}
                                {chunk && chunk.headings.length > 0
                                  ? ` › ${chunk.headings.join(' › ')}`
                                  : ''}
                              </p>
                              <p className="leading-relaxed">
                                {chunk?.content ?? 'This chunk has since been removed from memory.'}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {run.outcome ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            Outcome
          </h2>
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {run.outcome}
          </p>
        </section>
      ) : null}

      {run.childRuns.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            Delegated to
          </h2>
          <ul className="flex flex-col gap-1">
            {run.childRuns.map((child) => (
              <li key={child.id}>
                <Link href={`/runs/${child.id}`} className="text-sm hover:underline">
                  {child.department.key} — {child.objective ?? child.status}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function ToolCallRow({
  call,
}: {
  call: {
    id: string
    toolName: string
    risk: string
    status: string
    input: unknown
    output: unknown
    error: string | null
    durationMs: number | null
  }
}) {
  const blocked = call.status === 'awaiting_approval' || call.status === 'rejected'

  return (
    <li
      className={cn(
        'rounded-md border px-3 py-2',
        blocked ? 'border-warning/50 bg-warning/8' : 'border-border',
        call.status === 'failed' ? 'border-destructive/50 bg-destructive/5' : '',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-medium">{call.toolName}</span>
        <Badge
          variant={
            call.risk === 'read' ? 'outline' : call.risk === 'internal' ? 'default' : 'warning'
          }
        >
          {call.risk}
        </Badge>
        <span className="font-mono text-muted-foreground">{call.status}</span>
        {call.durationMs === null ? null : (
          <span className="font-mono text-muted-foreground">{call.durationMs}ms</span>
        )}
      </div>

      {blocked ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          This did not execute. It was recorded so there is a trace of what was attempted.
        </p>
      ) : null}

      {call.error ? <p className="mt-1.5 text-xs text-destructive">{call.error}</p> : null}

      <details className="mt-1.5">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          input / output
        </summary>
        <pre className="mt-1.5 max-h-56 overflow-auto rounded bg-muted p-2 font-mono text-[0.7rem]">
          {JSON.stringify({ input: call.input, output: call.output }, null, 2)}
        </pre>
      </details>
    </li>
  )
}
