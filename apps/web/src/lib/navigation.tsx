import { DEPARTMENT_IDS, DEPARTMENTS, type DepartmentId } from '@nexusai/core'
import {
  BrainIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarCheckIcon,
  CircleDollarSignIcon,
  CodeIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  ListChecksIcon,
  MegaphoneIcon,
  MicroscopeIcon,
  PlugIcon,
  ShieldCheckIcon,
  TargetIcon,
  WaypointsIcon,
  type LucideIcon,
} from 'lucide-react'

/**
 * Navigation is derived from the domain layer, not hand-maintained.
 *
 * The department list comes from `@nexusai/core`, so adding one cannot leave the
 * sidebar out of sync — the only thing that lives here is the icon, which is
 * presentation and has no business being in the domain.
 */

const DEPARTMENT_ICONS: Record<DepartmentId, LucideIcon> = {
  ceo: BuildingIcon,
  operations: WaypointsIcon,
  research: MicroscopeIcon,
  marketing: MegaphoneIcon,
  sales: BriefcaseIcon,
  support: LifeBuoyIcon,
  finance: CircleDollarSignIcon,
  engineering: CodeIcon,
  assistant: CalendarCheckIcon,
}

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Shown in the command palette to disambiguate similar names. */
  hint?: string
}

/**
 * Ordered by how often the operator needs it, not by hierarchy. Approvals sits
 * second because it is the only entry where the company is *waiting* on them.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboardIcon, hint: 'Today at a glance' },
  {
    href: '/approvals',
    label: 'Approvals',
    icon: ShieldCheckIcon,
    hint: 'Actions waiting on you',
  },
  { href: '/tasks', label: 'Tasks', icon: ListChecksIcon, hint: 'Everything in flight' },
  { href: '/reports', label: 'Reports', icon: FileTextIcon, hint: 'What the departments filed' },
  { href: '/goals', label: 'Goals', icon: TargetIcon, hint: 'What we are trying to achieve' },
  { href: '/memory', label: 'Memory', icon: BrainIcon, hint: 'Everything the company knows' },
]

export const SETTINGS_NAV: NavItem[] = [
  {
    href: '/settings/integrations',
    label: 'Integrations',
    icon: PlugIcon,
    hint: 'Connect the outside world',
  },
]

export const DEPARTMENT_NAV: (NavItem & { key: DepartmentId })[] = DEPARTMENT_IDS.map((key) => ({
  key,
  href: `/departments/${key}`,
  label: DEPARTMENTS[key].displayName,
  icon: DEPARTMENT_ICONS[key],
  hint: DEPARTMENTS[key].remit,
}))

/**
 * The icon as a *component*, not a component-valued variable.
 *
 * Assigning `const Icon = departmentIcon(key)` inside a render trips the React
 * Compiler's "cannot create components during render" rule — and it is right to:
 * a component identity that changes between renders remounts its subtree. Doing
 * the lookup inside a stable component avoids that entirely.
 */
export function DepartmentIcon({
  department,
  className,
}: {
  department: DepartmentId
  className?: string
}) {
  const Icon = DEPARTMENT_ICONS[department]
  return <Icon className={className} aria-hidden />
}

/** True when `href` is the active route, treating '/' as exact. */
export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}
