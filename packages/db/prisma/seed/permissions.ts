/**
 * The permission vocabulary and the role matrix.
 *
 * Permissions are `resource:action` pairs and live in a global table rather than
 * per workspace, because they are code-level vocabulary — adding one is a
 * deploy, not a user action. Roles are per workspace so they can be tuned later
 * without touching the vocabulary.
 *
 * This is defined for one user on purpose. Getting the shape right now, while it
 * costs nothing, is what makes adding a second person configuration rather than
 * a migration.
 */

export interface PermissionSeed {
  resource: string
  action: string
  description: string
}

export const PERMISSIONS: PermissionSeed[] = [
  { resource: 'workspace', action: 'read', description: 'View workspace details' },
  { resource: 'workspace', action: 'update', description: 'Rename, change timezone or currency' },

  { resource: 'department', action: 'read', description: 'View departments and their charters' },
  {
    resource: 'department',
    action: 'update',
    description: 'Edit a charter, tools or model routing',
  },
  { resource: 'department', action: 'run', description: 'Invoke a department agent' },

  { resource: 'task', action: 'read', description: 'View tasks' },
  { resource: 'task', action: 'create', description: 'Create tasks' },
  { resource: 'task', action: 'update', description: 'Change status, owner, priority' },
  { resource: 'task', action: 'delete', description: 'Delete tasks' },

  { resource: 'goal', action: 'read', description: 'View goals' },
  { resource: 'goal', action: 'create', description: 'Set goals' },
  { resource: 'goal', action: 'update', description: 'Edit or close goals' },
  { resource: 'goal', action: 'delete', description: 'Delete goals' },

  { resource: 'kpi', action: 'read', description: 'View KPIs and their history' },
  { resource: 'kpi', action: 'create', description: 'Define a KPI' },
  { resource: 'kpi', action: 'update', description: 'Edit a KPI or record a measurement' },

  { resource: 'report', action: 'read', description: 'Read department reports' },
  { resource: 'report', action: 'create', description: 'Generate a report' },

  { resource: 'memory', action: 'read', description: 'Search and read long-term memory' },
  { resource: 'memory', action: 'create', description: 'Add documents to memory' },
  { resource: 'memory', action: 'update', description: 'Edit or re-ingest a document' },
  { resource: 'memory', action: 'delete', description: 'Remove documents from memory' },

  { resource: 'approval', action: 'read', description: 'See pending approvals' },
  { resource: 'approval', action: 'decide', description: 'Approve or reject a gated action' },
  {
    resource: 'approval',
    action: 'confirm',
    description: 'Give the second confirmation for a financial action',
  },

  { resource: 'run', action: 'read', description: 'View agent runs and their timelines' },
  { resource: 'run', action: 'cancel', description: 'Stop a running agent' },

  { resource: 'audit', action: 'read', description: 'Read the audit log' },

  { resource: 'integration', action: 'read', description: 'See connected services' },
  {
    resource: 'integration',
    action: 'connect',
    description: 'Connect a service and store its credentials',
  },
  { resource: 'integration', action: 'disconnect', description: 'Disconnect a service' },

  { resource: 'setting', action: 'read', description: 'View system settings' },
  {
    resource: 'setting',
    action: 'update',
    description: 'Change settings, including the global pause',
  },
]

export const ALL_PERMISSIONS = PERMISSIONS.map(({ resource, action }) => `${resource}:${action}`)

/**
 * Deliberately withheld from every role except owner. Confirming a financial
 * action is the one place a second pair of eyes is the entire point, so it must
 * not be delegable by default.
 */
export const OWNER_ONLY: readonly string[] = ['approval:confirm', 'workspace:update']

export interface RoleSeed {
  key: string
  name: string
  description: string
  /** Explicit list, or '*' for everything. */
  permissions: string[] | '*'
}

export const ROLES: RoleSeed[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full control, including settings, integrations and financial confirmations.',
    permissions: '*',
  },
  {
    key: 'admin',
    name: 'Admin',
    description:
      'Everything except workspace identity and confirming money movement. Can approve ordinary actions and connect services.',
    permissions: ALL_PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p)),
  },
  {
    key: 'operator',
    name: 'Operator',
    description:
      'Runs the company day to day: creates work, invokes departments, approves ordinary actions. Cannot confirm financial actions or manage integrations.',
    permissions: [
      'workspace:read',
      'department:read',
      'department:run',
      'task:read',
      'task:create',
      'task:update',
      'goal:read',
      'goal:create',
      'goal:update',
      'kpi:read',
      'kpi:update',
      'report:read',
      'report:create',
      'memory:read',
      'memory:create',
      'memory:update',
      'approval:read',
      'approval:decide',
      'run:read',
      'run:cancel',
      'audit:read',
      'integration:read',
      'setting:read',
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only. Sees everything, changes nothing, cannot invoke an agent.',
    permissions: ALL_PERMISSIONS.filter((p) => p.endsWith(':read')),
  },
]
