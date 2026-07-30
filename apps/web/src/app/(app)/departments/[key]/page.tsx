import { Suspense } from 'react'

import { DEFAULT_TOOLS } from '@nexusai/agents'
import { DEPARTMENTS, departmentIdSchema, type DepartmentId } from '@nexusai/core'
import { prisma, runs as runRepo } from '@nexusai/db'
import { Badge, StatusDot } from '@nexusai/ui'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { DepartmentChat } from '@/components/department/chat'
import { DomainPanel, DomainPanelFallback, ToolBadges } from '@/components/department/domain-panel'
import { DepartmentIcon } from '@/lib/navigation'
import { requireSession } from '@/lib/session'

/**
 * A department console.
 *
 * One page for all nine — they differ by charter, tools and domain panel, not by
 * interface, which is the visible consequence of one kernel serving all of them.
 *
 * Two panes: the conversation, and the state that department owns. The second is
 * what stops this being a chat window — the pipeline, the ledger and the tickets
 * are on screen before anyone asks about them, and the chat is for the questions
 * a table cannot answer.
 */

const SUGGESTIONS: Partial<Record<DepartmentId, string[]>> = {
  ceo: [
    'What did we decide about pricing?',
    'What should I focus on this week?',
    'What are our current goals?',
  ],
  operations: ['What is running right now?', 'What is blocked?'],
  research: ['What do we know about our competitors?', 'Summarise what is in memory.'],
  marketing: ['What should I post about this week?', 'What tone do I write in?'],
  sales: ['What is in the pipeline?', 'Who should I follow up with?'],
  support: ['What questions keep coming up?'],
  finance: ['How is cash looking?', 'What did we spend on AI this month?'],
  engineering: ['What is the state of the codebase?'],
  assistant: ['What is on today?', 'Remind me what I said I would do.'],
}

const DEFAULT_SUGGESTIONS = ['What do you know about this?', 'What should I be doing?']

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>
}): Promise<Metadata> {
  const { key } = await params
  const parsed = departmentIdSchema.safeParse(key)

  return { title: parsed.success ? DEPARTMENTS[parsed.data].displayName : 'Department' }
}

export default async function DepartmentPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const parsed = departmentIdSchema.safeParse(key)
  if (!parsed.success) notFound()

  const { workspace } = await requireSession()
  const departmentKey = parsed.data

  const department = await prisma.department.findUnique({
    where: { workspaceId_key: { workspaceId: workspace.id, key: departmentKey } },
    include: { config: true },
  })

  if (!department) notFound()

  const recent = await runRepo.findRecentRuns(prisma, {
    workspaceId: workspace.id,
    departmentKey,
    limit: 1,
  })

  // The *effective* lists, matching what the kernel will actually use. An empty
  // configuration means "fall back to the code default", so showing the raw
  // column would tell the operator this department has no tools while it
  // demonstrably uses several.
  const configured = (department.config?.tools ?? []) as string[]
  const tools = configured.length > 0 ? configured : [...DEFAULT_TOOLS]

  const configuredScopes = (department.config?.memoryScopes ?? []) as string[]
  const scopes = configuredScopes.length > 0 ? configuredScopes : ['company', departmentKey]

  const status =
    recent[0]?.status === 'running'
      ? 'working'
      : recent[0]?.status === 'awaiting_approval'
        ? 'waiting'
        : recent[0]?.status === 'failed'
          ? 'failed'
          : 'idle'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <DepartmentIcon department={departmentKey} className="size-5 shrink-0 text-primary" />
          <h1 className="flex-1 text-lg font-semibold tracking-tight">{department.displayName}</h1>
          <StatusDot status={status} withLabel />
        </div>

        <p className="max-w-2xl text-sm text-muted-foreground">
          {DEPARTMENTS[departmentKey].remit}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <ToolBadges tools={tools} />
          {scopes.length > 0 ? (
            <Badge variant="accent" className="font-mono text-[0.65rem]">
              memory: {scopes.join(', ')}
            </Badge>
          ) : null}
        </div>
      </header>

      {/* Chat and domain side by side on a wide screen; stacked below it, with the
          conversation first, because on a phone the operator came here to ask. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col xl:overflow-hidden">
          <DepartmentChat
            department={departmentKey}
            displayName={department.displayName}
            suggestions={SUGGESTIONS[departmentKey] ?? DEFAULT_SUGGESTIONS}
          />
        </div>

        <aside className="w-full shrink-0 border-t border-border p-4 xl:w-96 xl:overflow-y-auto xl:border-t-0 xl:border-l">
          {/* Suspense per pane: a slow ledger query must not delay the chat input. */}
          <Suspense fallback={<DomainPanelFallback />}>
            <DomainPanel
              department={departmentKey}
              workspaceId={workspace.id}
              currency={workspace.currency}
            />
          </Suspense>
        </aside>
      </div>
    </div>
  )
}
