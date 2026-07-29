'use client'

import type { DepartmentId } from '@nexusai/core'
import { Badge, StatusDot, cn, type Status } from '@nexusai/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { DEPARTMENT_NAV, PRIMARY_NAV, isActive } from '@/lib/navigation'

export interface DepartmentStatus {
  key: DepartmentId
  status: Status
  /** Runs in the last 24 hours. Shown as a count so idle departments look idle. */
  recentRuns: number
}

interface SidebarProps {
  workspaceName: string
  departments: DepartmentStatus[]
  pendingApprovals: number
}

export function Sidebar({ workspaceName, departments, pendingApprovals }: SidebarProps) {
  const pathname = usePathname()
  const statusByKey = new Map(departments.map((d) => [d.key, d]))

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-4"
    >
      <div className="flex items-center gap-2 px-2">
        <span className="size-2 rounded-full bg-primary" aria-hidden />
        <span className="truncate text-sm font-semibold tracking-tight">{workspaceName}</span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {PRIMARY_NAV.map((item) => (
          <li key={item.href}>
            <NavLink
              href={item.href}
              active={isActive(pathname, item.href)}
              icon={<item.icon className="size-4" aria-hidden />}
              label={item.label}
              trailing={
                item.href === '/approvals' && pendingApprovals > 0 ? (
                  <Badge variant="warning">{pendingApprovals}</Badge>
                ) : null
              }
            />
          </li>
        ))}
      </ul>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <h2 className="px-2 font-mono text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
          Departments
        </h2>
        <ul className="flex flex-col gap-0.5 overflow-y-auto">
          {DEPARTMENT_NAV.map((item) => {
            const state = statusByKey.get(item.key)
            return (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  active={isActive(pathname, item.href)}
                  icon={<item.icon className="size-4" aria-hidden />}
                  label={item.label}
                  trailing={<StatusDot status={state?.status ?? 'idle'} />}
                />
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}

interface NavLinkProps {
  href: string
  active: boolean
  icon: React.ReactNode
  label: string
  trailing?: React.ReactNode
}

function NavLink({ href, active, icon, label, trailing }: NavLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        'duration-(--duration-fast) ease-(--ease-standard)',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-primary' : '')}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  )
}
