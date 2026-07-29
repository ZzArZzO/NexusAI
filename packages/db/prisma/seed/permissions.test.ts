import { DEPARTMENT_PERMISSIONS, SYSTEM_PERMISSIONS } from '@nexusai/core'
import { describe, expect, test } from 'vitest'

import { ALL_PERMISSIONS, OWNER_ONLY, PERMISSIONS, ROLES } from './permissions'

/**
 * The permission matrix is data, and data with rules. These tests are the rules.
 *
 * They matter more than usual because the Policy layer is the only
 * authorization control in this deployment — row-level security is deliberately
 * not enabled. A mistake in this file is not caught by anything downstream.
 */

function permissionsOf(roleKey: string): string[] {
  const role = ROLES.find((r) => r.key === roleKey)
  if (!role) throw new Error(`No role "${roleKey}"`)
  return role.permissions === '*' ? [...ALL_PERMISSIONS] : role.permissions
}

describe('permission vocabulary', () => {
  test('every permission is unique', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length)
  })

  test('every permission has a description', () => {
    const undocumented = PERMISSIONS.filter((p) => p.description.trim() === '')
    expect(undocumented).toEqual([])
  })

  test('every permission is resource:action shaped', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+(\.[a-z]+)?:[a-z]+$/)
    }
  })
})

describe('role matrix', () => {
  test('every granted permission exists in the vocabulary', () => {
    for (const role of ROLES) {
      const granted = permissionsOf(role.key)
      const unknown = granted.filter((p) => !ALL_PERMISSIONS.includes(p))

      expect(unknown, `role "${role.key}" grants unknown permissions`).toEqual([])
    }
  })

  test('owner holds everything', () => {
    expect(permissionsOf('owner').sort()).toEqual([...ALL_PERMISSIONS].sort())
  })

  test('viewer holds only read permissions', () => {
    const writes = permissionsOf('viewer').filter((p) => !p.endsWith(':read'))
    expect(writes).toEqual([])
  })

  test('viewer cannot invoke an agent', () => {
    // Running a department costs money and takes actions. Read-only must mean it.
    expect(permissionsOf('viewer')).not.toContain('department:run')
  })

  test('owner-only permissions are held by nobody else', () => {
    for (const role of ROLES.filter((r) => r.key !== 'owner')) {
      const granted = permissionsOf(role.key)
      const escalations = OWNER_ONLY.filter((p) => granted.includes(p))

      expect(escalations, `role "${role.key}" should not hold owner-only permissions`).toEqual([])
    }
  })

  test('operator can approve ordinary actions but not confirm financial ones', () => {
    const operator = permissionsOf('operator')

    expect(operator).toContain('approval:decide')
    expect(operator).not.toContain('approval:confirm')
  })

  test('operator cannot connect integrations or change settings', () => {
    const operator = permissionsOf('operator')

    expect(operator).not.toContain('integration:connect')
    expect(operator).not.toContain('setting:update')
  })

  test('no role except owner and admin can delete anything', () => {
    for (const key of ['operator', 'viewer']) {
      const deletes = permissionsOf(key).filter((p) => p.endsWith(':delete'))
      expect(deletes, `role "${key}" should not hold delete permissions`).toEqual([])
    }
  })

  test('roles are ordered from most to least privileged', () => {
    // Not cosmetic: the UI renders them in this order, and a role list that
    // implies viewer outranks admin invites the wrong click.
    const sizes = ROLES.map((r) => permissionsOf(r.key).length)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
  })
})

describe('agent permissions are narrower than any human role', () => {
  test('departments hold strictly fewer permissions than an operator', () => {
    const operator = new Set(permissionsOf('operator'))
    const beyond = DEPARTMENT_PERMISSIONS.filter((p) => !operator.has(p))

    expect(beyond, 'an agent must not exceed what an operator may do').toEqual([])
    expect(DEPARTMENT_PERMISSIONS.length).toBeLessThan(operator.size)
  })

  test('system jobs hold strictly fewer permissions than a department', () => {
    const departmentSet = new Set<string>(DEPARTMENT_PERMISSIONS)
    const beyond = SYSTEM_PERMISSIONS.filter((p) => !departmentSet.has(p))

    // A scheduled sweep updates memory, which departments cannot do; everything
    // else must be a subset. Assert the exception explicitly rather than
    // loosening the rule.
    expect(beyond).toEqual(['memory:update'])
  })

  test('every department permission exists in the vocabulary', () => {
    const unknown = DEPARTMENT_PERMISSIONS.filter((p) => !ALL_PERMISSIONS.includes(p))
    expect(unknown).toEqual([])
  })

  test('every system permission exists in the vocabulary', () => {
    const unknown = SYSTEM_PERMISSIONS.filter((p) => !ALL_PERMISSIONS.includes(p))
    expect(unknown).toEqual([])
  })
})
