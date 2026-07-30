import { DEPARTMENT_IDS, DEPARTMENT_TOOLS, PLATFORM_TOOLS, type DepartmentId } from '@nexusai/core'
import { describe, expect, it } from 'vitest'

import { ModelRouter } from '../models/router'
import { createRegistry } from './builtin'

/**
 * The grants and the registry are two lists in two packages that must agree.
 *
 * They live apart on purpose — the seed in `@nexusai/db` cannot import
 * `@nexusai/agents` without a cycle — so this is the test that keeps them
 * honest. Without it, renaming a tool would silently strip a department of a
 * capability, and the only symptom would be an agent that quietly stops trying.
 */

const registry = createRegistry({
  router: new ModelRouter({}),
  scopes: ['company'],
})

describe('department tool grants', () => {
  it('grants only tools that exist in the registry', () => {
    const known = new Set(registry.names())
    const unknown: string[] = []

    for (const id of DEPARTMENT_IDS) {
      for (const name of DEPARTMENT_TOOLS[id]) {
        if (!known.has(name)) unknown.push(`${id} → ${name}`)
      }
    }

    expect(unknown).toEqual([])
  })

  it('registers no tool that no department can reach', () => {
    const granted = new Set(DEPARTMENT_IDS.flatMap((id) => [...DEPARTMENT_TOOLS[id]]))

    // A registered tool nobody is granted is dead weight the model never sees —
    // harmless, but it means the grant list was forgotten when the tool landed.
    expect(registry.names().filter((name) => !granted.has(name))).toEqual([])
  })

  it('gives every department the platform tools', () => {
    for (const id of DEPARTMENT_IDS) {
      expect(DEPARTMENT_TOOLS[id]).toEqual(expect.arrayContaining([...PLATFORM_TOOLS]))
    }
  })

  it('grants financial tools to Finance alone', () => {
    const financial = registry.byRisk('financial').map((tool) => tool.name)
    expect(financial.length).toBeGreaterThan(0)

    for (const id of DEPARTMENT_IDS) {
      const held = financial.filter((name) => DEPARTMENT_TOOLS[id].includes(name))
      expect(held, `${id} holds ${held.join(', ')}`).toEqual(id === 'finance' ? financial : [])
    }
  })

  it('keeps the orchestrators out of domain work', () => {
    // The CEO and Operations coordinate. If either could publish, sell or pay,
    // it would eventually do the work itself rather than delegate — and the
    // department that owns the domain would be bypassed silently.
    const domainOnly = registry
      .names()
      .filter((name) => !PLATFORM_TOOLS.includes(name as (typeof PLATFORM_TOOLS)[number]))
      .filter((name) => registry.get(name)?.risk !== 'read')

    const orchestratorTools = (['ceo', 'operations'] satisfies DepartmentId[]).flatMap((id) =>
      domainOnly.filter((name) => DEPARTMENT_TOOLS[id].includes(name)),
    )

    // Operations may assign work and record dependencies; that is coordination,
    // not domain execution.
    expect(orchestratorTools.sort()).toEqual(['dependency.add', 'task.assign'])
  })

  it('grants no department a tool it cannot afford to be trusted with silently', () => {
    // Every gated tool must carry a `describe`, because the operator reads that
    // summary to decide. A gated tool without one shows them the raw tool name.
    const gated = [...registry.byRisk('external'), ...registry.byRisk('financial')]
    const undescribed = gated.filter((tool) => tool.describe === undefined).map((t) => t.name)

    expect(undescribed).toEqual([])
  })
})
