import { describe, expect, test } from 'vitest'

import {
  canDelegate,
  DEPARTMENT_IDS,
  DEPARTMENTS,
  departmentProfile,
  type DepartmentId,
} from './department'

describe('department registry', () => {
  test('every declared id has a profile', () => {
    for (const id of DEPARTMENT_IDS) {
      expect(departmentProfile(id).id).toBe(id)
    }
  })

  test('delegation targets are all real departments', () => {
    for (const id of DEPARTMENT_IDS) {
      for (const target of DEPARTMENTS[id].canDelegateTo) {
        expect(DEPARTMENT_IDS).toContain(target)
      }
    }
  })

  test('no department may delegate to itself', () => {
    for (const id of DEPARTMENT_IDS) {
      expect(canDelegate(id, id)).toBe(false)
    }
  })

  test('CEO can reach every other department', () => {
    const others = DEPARTMENT_IDS.filter((id) => id !== 'ceo')

    for (const target of others) {
      expect(canDelegate('ceo', target)).toBe(true)
    }
  })

  test('leaf departments cannot delegate outward', () => {
    expect(canDelegate('research', 'marketing')).toBe(false)
  })

  test('the delegation graph is acyclic', () => {
    // A cycle here would let two departments hand work back and forth forever.
    const visiting = new Set<DepartmentId>()
    const done = new Set<DepartmentId>()

    const walk = (id: DepartmentId): void => {
      if (done.has(id)) return
      if (visiting.has(id)) throw new Error(`Delegation cycle detected at "${id}"`)

      visiting.add(id)
      for (const target of DEPARTMENTS[id].canDelegateTo) walk(target)
      visiting.delete(id)
      done.add(id)
    }

    expect(() => DEPARTMENT_IDS.forEach(walk)).not.toThrow()
  })
})
