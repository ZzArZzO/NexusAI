import { prisma } from '@nexusai/db'
import { Badge, Card, CardHeader, CardTitle, EmptyState } from '@nexusai/ui'
import { format } from 'date-fns'
import { FileTextIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { requireSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Reports' }

/**
 * Everything the departments have filed.
 *
 * Unread reports are marked, because a company that writes reports nobody opens
 * is doing work for its own benefit. The marker is on the row rather than a
 * separate count, so it is impossible to see the list without seeing the backlog.
 */
export default async function ReportsPage() {
  const { workspace } = await requireSession()

  const reports = await prisma.report.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      readAt: true,
      createdAt: true,
      department: { select: { displayName: true } },
    },
  })

  const unread = reports.filter((report) => report.readAt === null).length

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          What the departments have written for you.
          {unread > 0 ? ` ${unread} unread.` : ' All read.'}
        </p>
      </header>

      {reports.length === 0 ? (
        <div className="rounded-xl border border-border">
          <EmptyState
            icon={FileTextIcon}
            title="No reports yet"
            description="Departments file reports for anything worth reading later. They are also written into long-term memory, so they can be recalled months from now."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => (
            <li key={report.id}>
              <Link href={`/reports/${report.id}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardHeader className="gap-1.5 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base leading-snug">{report.title}</CardTitle>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {report.readAt === null ? <Badge variant="accent">new</Badge> : null}
                        <Badge variant="outline">{report.kind.replace(/_/g, ' ')}</Badge>
                      </div>
                    </div>

                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {/* First paragraph of the body, with markdown syntax stripped —
                          a preview showing `## Summary` tells the reader nothing. */}
                      {report.body
                        .replace(/[#*_`>-]/g, '')
                        .trim()
                        .slice(0, 240)}
                    </p>

                    <p className="font-mono text-xs text-muted-foreground">
                      {report.department.displayName} · {format(report.createdAt, 'd MMM yyyy')}
                    </p>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
