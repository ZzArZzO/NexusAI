import { ForbiddenError } from './errors'
import type { DepartmentId } from './domain/department'

/**
 * Authorization.
 *
 * This module is the *only* place a "may X do Y" question is answered. That
 * matters more here than in most systems: Postgres row-level security is
 * deliberately not enabled (see docs/ADR/0001), because with the stack
 * self-hosted nothing reaches the database except this application. The
 * consequence is that there is no second lock. If a code path skips `assert`,
 * nothing else stops it.
 *
 * Three properties follow from that, and the tests enforce all three:
 *
 *   1. **No implicit allow.** Every actor carries an explicit permission set.
 *      There is no superuser branch, no `if (isAdmin) return true`, and no
 *      actor kind that bypasses the check.
 *   2. **Tenancy is checked with permission, not instead of it.** Holding
 *      `task:update` does not authorise updating *someone else's* task, so the
 *      resource-scoped API takes both and checks both.
 *   3. **Agents are not users.** A department acts with a fixed, narrow
 *      permission set that no human role can widen at runtime.
 */

/** `resource:action`, e.g. `task:create`. */
export type Permission = string

interface BaseActor {
  readonly workspaceId: string
  readonly permissions: ReadonlySet<Permission>
}

export interface UserActor extends BaseActor {
  readonly kind: 'user'
  readonly id: string
  readonly roleKey: string
}

export interface DepartmentActor extends BaseActor {
  readonly kind: 'department'
  /** Department row id, for audit attribution. */
  readonly id: string
  readonly key: DepartmentId
}

/**
 * Scheduled jobs and maintenance. Still carries an explicit permission set —
 * "it's internal" is exactly the reasoning that produces a privilege escalation.
 */
export interface SystemActor extends BaseActor {
  readonly kind: 'system'
  readonly id: 'system'
  /** Why this job is running, recorded in the audit log. */
  readonly reason: string
}

export type Actor = UserActor | DepartmentActor | SystemActor

/**
 * What a department agent may do, whoever triggered it.
 *
 * Deliberately narrower than any human role. Note what is absent: no
 * `approval:decide` (an agent cannot approve its own action), no
 * `setting:update` (an agent cannot lift the pause that constrains it), no
 * `integration:connect`, no delete of any kind, and no `memory:delete` — an
 * agent that can erase the record of what it did is not auditable.
 */
export const DEPARTMENT_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'department:read',
  'task:read',
  'task:create',
  'task:update',
  'goal:read',
  'kpi:read',
  'kpi:update',
  'report:read',
  'report:create',
  'memory:read',
  'memory:create',
  'run:read',
  'approval:read',
]

/** Scheduled maintenance: sweep expired approvals, backfill embeddings, roll up KPIs. */
export const SYSTEM_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'department:read',
  'task:read',
  'task:update',
  'kpi:read',
  'kpi:update',
  'memory:read',
  'memory:update',
  'approval:read',
  'run:read',
]

export function userActor(params: {
  id: string
  workspaceId: string
  roleKey: string
  permissions: Iterable<Permission>
}): UserActor {
  return {
    kind: 'user',
    id: params.id,
    workspaceId: params.workspaceId,
    roleKey: params.roleKey,
    permissions: new Set(params.permissions),
  }
}

export function departmentActor(params: {
  id: string
  key: DepartmentId
  workspaceId: string
}): DepartmentActor {
  return {
    kind: 'department',
    id: params.id,
    key: params.key,
    workspaceId: params.workspaceId,
    permissions: new Set(DEPARTMENT_PERMISSIONS),
  }
}

export function systemActor(params: { workspaceId: string; reason: string }): SystemActor {
  return {
    kind: 'system',
    id: 'system',
    workspaceId: params.workspaceId,
    reason: params.reason,
    permissions: new Set(SYSTEM_PERMISSIONS),
  }
}

/** Does this actor hold the permission at all? Says nothing about which rows. */
export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission)
}

/** Does this actor belong to the workspace that owns the resource? */
export function inWorkspace(actor: Actor, resource: { workspaceId: string }): boolean {
  return actor.workspaceId === resource.workspaceId
}

export class CrossWorkspaceError extends ForbiddenError {
  constructor(actorWorkspaceId: string, resourceWorkspaceId: string) {
    super(
      'workspace',
      `Actor belongs to workspace ${actorWorkspaceId} but the resource belongs to ${resourceWorkspaceId}.`,
    )
  }
}

/**
 * The primary entry point. Throws rather than returning false, so a forgotten
 * `if` cannot silently authorise anything.
 *
 * Pass `resource` for anything that belongs to a workspace — which is nearly
 * everything. Omitting it is only correct for genuinely workspace-independent
 * checks, and is worth a comment at the call site when you do.
 */
export function assert(
  actor: Actor,
  permission: Permission,
  resource?: { workspaceId: string },
): void {
  if (resource !== undefined && !inWorkspace(actor, resource)) {
    // Checked before the permission so a cross-tenant probe cannot use the
    // difference between "forbidden" and "not found" to confirm a resource exists.
    throw new CrossWorkspaceError(actor.workspaceId, resource.workspaceId)
  }

  if (!can(actor, permission)) {
    throw new ForbiddenError(permission)
  }
}

/** Assert several permissions at once. All must hold. */
export function assertAll(
  actor: Actor,
  permissions: readonly Permission[],
  resource?: { workspaceId: string },
): void {
  for (const permission of permissions) {
    assert(actor, permission, resource)
  }
}

/**
 * Filter a list to the rows this actor may see.
 *
 * Useful, but not a substitute for scoping the query itself: fetching
 * everything and filtering in memory leaks row counts through timing and wastes
 * work. Prefer a `where` clause; reach for this only when the source is already
 * in memory.
 */
export function visible<T extends { workspaceId: string }>(actor: Actor, rows: readonly T[]): T[] {
  return rows.filter((row) => inWorkspace(actor, row))
}

/** Human-readable actor label for audit entries and the activity feed. */
export function describeActor(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
      return `user:${actor.id}`
    case 'department':
      return `department:${actor.key}`
    case 'system':
      return `system:${actor.reason}`
  }
}

/**
 * Audit attribution. Exactly one of the three is set — a person, an agent, or a
 * named system job. The third exists so a scheduled sweep is not recorded as an
 * anonymous change, which would be the one audit entry nobody can explain.
 */
export function auditActor(
  actor: Actor,
): { userId: string } | { departmentId: string } | { system: string } {
  switch (actor.kind) {
    case 'user':
      return { userId: actor.id }
    case 'department':
      return { departmentId: actor.id }
    case 'system':
      return { system: actor.reason }
  }
}
