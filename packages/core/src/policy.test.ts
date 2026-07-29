import { describe, expect, test } from 'vitest'

import { ForbiddenError } from './errors'
import {
  assert,
  assertAll,
  auditActor,
  can,
  CrossWorkspaceError,
  DEPARTMENT_PERMISSIONS,
  departmentActor,
  describeActor,
  inWorkspace,
  systemActor,
  SYSTEM_PERMISSIONS,
  userActor,
  visible,
} from './policy'

const WORKSPACE = 'ws-1'
const OTHER_WORKSPACE = 'ws-2'

const owner = userActor({
  id: 'u1',
  workspaceId: WORKSPACE,
  roleKey: 'owner',
  permissions: ['task:create', 'task:read', 'approval:confirm', 'setting:update'],
})

const viewer = userActor({
  id: 'u2',
  workspaceId: WORKSPACE,
  roleKey: 'viewer',
  permissions: ['task:read'],
})

describe('can', () => {
  test('is true for a held permission', () => {
    expect(can(owner, 'task:create')).toBe(true)
  })

  test('is false for one that is not held', () => {
    expect(can(viewer, 'task:create')).toBe(false)
  })

  test('has no superuser branch — even an owner is only its explicit set', () => {
    // The owner role is granted everything by the seed, but the *policy* has no
    // concept of "owner therefore yes". An actor constructed without a
    // permission does not hold it, whatever its role is called.
    const nominalOwner = userActor({
      id: 'u3',
      workspaceId: WORKSPACE,
      roleKey: 'owner',
      permissions: [],
    })

    expect(can(nominalOwner, 'task:read')).toBe(false)
  })
})

describe('assert', () => {
  test('passes silently when the permission is held', () => {
    expect(() => assert(owner, 'task:create')).not.toThrow()
  })

  test('throws ForbiddenError when it is not', () => {
    expect(() => assert(viewer, 'task:create')).toThrow(ForbiddenError)
  })

  test('names the missing permission in the error', () => {
    expect(() => assert(viewer, 'task:create')).toThrow(/task:create/)
  })

  test('does not leak the reason to the user-facing message', () => {
    try {
      assert(viewer, 'task:create')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as ForbiddenError).userMessage).toBe('You do not have permission to do that.')
      expect((error as ForbiddenError).userMessage).not.toContain('task:create')
    }
  })
})

describe('workspace isolation', () => {
  test('a held permission does not authorise another workspace', () => {
    // This is the property that matters most: with RLS deliberately not enabled,
    // nothing below this check separates tenants.
    expect(() => assert(owner, 'task:create', { workspaceId: OTHER_WORKSPACE })).toThrow(
      CrossWorkspaceError,
    )
  })

  test('the workspace is checked before the permission', () => {
    // Otherwise the difference between "forbidden" and "not found" would confirm
    // whether a resource exists in another workspace.
    const strangerWithoutPermission = userActor({
      id: 'u4',
      workspaceId: WORKSPACE,
      roleKey: 'viewer',
      permissions: [],
    })

    expect(() =>
      assert(strangerWithoutPermission, 'task:create', { workspaceId: OTHER_WORKSPACE }),
    ).toThrow(CrossWorkspaceError)
  })

  test('passes when the resource belongs to the actor workspace', () => {
    expect(() => assert(owner, 'task:create', { workspaceId: WORKSPACE })).not.toThrow()
  })

  test('inWorkspace reports membership without throwing', () => {
    expect(inWorkspace(owner, { workspaceId: WORKSPACE })).toBe(true)
    expect(inWorkspace(owner, { workspaceId: OTHER_WORKSPACE })).toBe(false)
  })

  test('visible filters out rows from other workspaces', () => {
    const rows = [
      { id: 'a', workspaceId: WORKSPACE },
      { id: 'b', workspaceId: OTHER_WORKSPACE },
      { id: 'c', workspaceId: WORKSPACE },
    ]

    expect(visible(owner, rows).map((r) => r.id)).toEqual(['a', 'c'])
  })
})

describe('assertAll', () => {
  test('passes when every permission is held', () => {
    expect(() => assertAll(owner, ['task:create', 'task:read'])).not.toThrow()
  })

  test('throws on the first missing one', () => {
    expect(() => assertAll(owner, ['task:read', 'memory:delete'])).toThrow(/memory:delete/)
  })
})

describe('department actors', () => {
  const marketing = departmentActor({ id: 'dep-1', key: 'marketing', workspaceId: WORKSPACE })

  test('may do ordinary work', () => {
    expect(can(marketing, 'memory:read')).toBe(true)
    expect(can(marketing, 'task:create')).toBe(true)
    expect(can(marketing, 'report:create')).toBe(true)
  })

  test('cannot approve — an agent must never clear its own gate', () => {
    expect(can(marketing, 'approval:decide')).toBe(false)
    expect(can(marketing, 'approval:confirm')).toBe(false)
  })

  test('cannot change settings — an agent must not lift the pause that constrains it', () => {
    expect(can(marketing, 'setting:update')).toBe(false)
  })

  test('cannot delete memory — an agent that can erase its own trail is not auditable', () => {
    expect(can(marketing, 'memory:delete')).toBe(false)
  })

  test('cannot connect integrations or delete anything', () => {
    expect(can(marketing, 'integration:connect')).toBe(false)
    expect(can(marketing, 'task:delete')).toBe(false)
    expect(can(marketing, 'goal:delete')).toBe(false)
  })

  test('the department permission set contains no delete or approve action', () => {
    const dangerous = DEPARTMENT_PERMISSIONS.filter(
      (p) => p.endsWith(':delete') || p === 'approval:decide' || p === 'approval:confirm',
    )

    expect(dangerous).toEqual([])
  })

  test('is still bound by workspace isolation', () => {
    expect(() => assert(marketing, 'memory:read', { workspaceId: OTHER_WORKSPACE })).toThrow(
      CrossWorkspaceError,
    )
  })
})

describe('system actors', () => {
  const sweeper = systemActor({ workspaceId: WORKSPACE, reason: 'expire-approvals' })

  test('carry an explicit permission set rather than bypassing checks', () => {
    expect(can(sweeper, 'approval:read')).toBe(true)
    expect(can(sweeper, 'setting:update')).toBe(false)
  })

  test('cannot decide approvals', () => {
    expect(can(sweeper, 'approval:decide')).toBe(false)
  })

  test('the system permission set contains no delete action', () => {
    expect(SYSTEM_PERMISSIONS.filter((p) => p.endsWith(':delete'))).toEqual([])
  })
})

describe('audit attribution', () => {
  test('a user is attributed by id', () => {
    expect(auditActor(owner)).toEqual({ userId: 'u1' })
  })

  test('a department is attributed by department id', () => {
    const marketing = departmentActor({ id: 'dep-1', key: 'marketing', workspaceId: WORKSPACE })
    expect(auditActor(marketing)).toEqual({ departmentId: 'dep-1' })
  })

  test('a system job is attributed by name, never anonymously', () => {
    const sweeper = systemActor({ workspaceId: WORKSPACE, reason: 'expire-approvals' })
    expect(auditActor(sweeper)).toEqual({ system: 'expire-approvals' })
  })

  test('describeActor produces a readable label for each kind', () => {
    expect(describeActor(owner)).toBe('user:u1')
    expect(describeActor(departmentActor({ id: 'd', key: 'ceo', workspaceId: WORKSPACE }))).toBe(
      'department:ceo',
    )
    expect(describeActor(systemActor({ workspaceId: WORKSPACE, reason: 'backfill' }))).toBe(
      'system:backfill',
    )
  })
})
