import { can, DEPARTMENT_IDS, type DepartmentId } from '@nexusai/core'
import { hasModelProviders } from '@nexusai/core/env/server'
import { prisma, workspaces } from '@nexusai/db'
import type { Status } from '@nexusai/ui'
import type { ReactNode } from 'react'
import { Toaster } from 'sonner'

import { Sidebar, type DepartmentStatus } from '@/components/shell/sidebar'
import { Topbar } from '@/components/shell/topbar'
import { serverNow } from '@/lib/now'
import { requireSession } from '@/lib/session'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Derive a department's badge from its runs rather than storing a status column.
 *
 * A stored status is a lie waiting to happen: a crashed process leaves it
 * saying "working" forever. Reading it from the runs means it is always true by
 * construction.
 */
function deriveStatus(runs: { status: string }[]): Status {
  if (runs.some((r) => r.status === 'running')) return 'working'
  if (runs.some((r) => r.status === 'awaiting_approval')) return 'waiting'
  if (runs[0]?.status === 'failed') return 'failed'
  return 'idle'
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { actor, user, workspace } = await requireSession()

  // Read the clock once, so every department's "recent" window is the same
  // window rather than each one sampling a slightly different moment.
  const since = new Date(serverNow() - DAY_MS)

  const [departments, recentRuns, pendingApprovals, paused] = await Promise.all([
    prisma.department.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, key: true },
    }),
    prisma.run.findMany({
      where: { workspaceId: workspace.id, startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      select: { status: true, department: { select: { key: true } } },
    }),
    prisma.approvalRequest.count({ where: { workspaceId: workspace.id, status: 'pending' } }),
    workspaces.isAutomationPaused(prisma, workspace.id),
  ])

  const runsByDepartment = new Map<DepartmentId, { status: string }[]>()
  for (const run of recentRuns) {
    const key: DepartmentId = run.department.key
    runsByDepartment.set(key, [...(runsByDepartment.get(key) ?? []), { status: run.status }])
  }

  const statuses: DepartmentStatus[] = DEPARTMENT_IDS.map((key) => {
    const runs = runsByDepartment.get(key) ?? []
    const known = departments.some((d) => d.key === key)
    return {
      key,
      status: known ? deriveStatus(runs) : 'off',
      recentRuns: runs.length,
    }
  })

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        workspaceName={workspace.name}
        departments={statuses}
        pendingApprovals={pendingApprovals}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userName={user.name}
          automationPaused={paused}
          canPause={can(actor, 'setting:update')}
          usingMockModels={!hasModelProviders()}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: 'border-border bg-popover text-popover-foreground',
            description: 'text-muted-foreground',
          },
        }}
      />
    </div>
  )
}
