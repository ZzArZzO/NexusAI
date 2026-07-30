import { prisma } from '@nexusai/db'
import { Badge } from '@nexusai/ui'
import { format } from 'date-fns'
import { ArrowLeftIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireSession } from '@/lib/session'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const report = await prisma.report.findUnique({ where: { id }, select: { title: true } })

  return { title: report?.title ?? 'Report' }
}

/**
 * One report, with what produced it.
 *
 * The link back to the run is the point. "Why does Research believe this?" is
 * answerable in two clicks: the run, then its steps, then the memory chunks it
 * cited — which is the explainability requirement made concrete rather than
 * promised.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { workspace } = await requireSession()

  const report = await prisma.report.findFirst({
    where: { id, workspaceId: workspace.id },
    include: {
      department: { select: { displayName: true, key: true } },
      sources: { select: { id: true, url: true, title: true, retrievedAt: true } },
    },
  })

  if (!report) notFound()

  // Opening it marks it read. Done here rather than behind a button because the
  // operator has demonstrably read it, and a "mark as read" control asks them to
  // restate something the system already knows.
  if (report.readAt === null) {
    await prisma.report.update({ where: { id: report.id }, data: { readAt: new Date() } })
  }

  const highlights = Array.isArray(report.highlights) ? (report.highlights as unknown[]) : []

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
      <Link
        href="/reports"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        All reports
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{report.kind.replace(/_/g, ' ')}</Badge>
          <Link href={`/departments/${report.department.key}`}>
            <Badge variant="accent">{report.department.displayName}</Badge>
          </Link>
          {report.runId ? (
            <Link href={`/runs/${report.runId}`}>
              <Badge variant="outline">see the run that wrote this</Badge>
            </Link>
          ) : null}
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-balance">{report.title}</h1>

        <p className="font-mono text-xs text-muted-foreground">
          {format(report.createdAt, 'd MMMM yyyy, HH:mm')}
          {report.periodStart && report.periodEnd
            ? ` · covering ${format(report.periodStart, 'd MMM')} to ${format(report.periodEnd, 'd MMM')}`
            : ''}
        </p>
      </header>

      {highlights.length > 0 ? (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-border bg-card/60 p-4">
          {highlights.map((highlight, index) => (
            <li key={index} className="flex gap-2.5 text-sm">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <span>{typeof highlight === 'string' ? highlight : JSON.stringify(highlight)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Markdown is rendered as pre-wrapped text rather than parsed. A report is
          the output of a language model, and running it through an HTML renderer
          would be the one place in this app where model output becomes markup. */}
      <div className="text-sm leading-relaxed whitespace-pre-wrap">{report.body}</div>

      {report.sources.length > 0 ? (
        <section className="flex flex-col gap-2 border-t border-border pt-5">
          <h2 className="font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            Sources
          </h2>
          <ul className="flex flex-col gap-1.5">
            {report.sources.map((source) => (
              <li key={source.id} className="flex items-baseline gap-2 text-sm">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {source.title ?? source.url}
                </a>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {format(source.retrievedAt, 'd MMM yyyy')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}
