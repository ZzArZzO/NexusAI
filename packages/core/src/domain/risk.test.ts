import { describe, expect, test } from 'vitest'

import {
  highestRisk,
  requiresApproval,
  requiresSecondConfirmation,
  RISK_TIERS,
  riskRank,
} from './risk'

describe('risk tiers', () => {
  test('read and internal execute without approval', () => {
    expect(requiresApproval('read')).toBe(false)
    expect(requiresApproval('internal')).toBe(false)
  })

  test('anything leaving the system requires approval', () => {
    expect(requiresApproval('external')).toBe(true)
    expect(requiresApproval('financial')).toBe(true)
  })

  test('only financial actions require a second confirmation', () => {
    expect(requiresSecondConfirmation('financial')).toBe(true)
    expect(requiresSecondConfirmation('external')).toBe(false)
  })

  test('tiers are ordered from least to most dangerous', () => {
    const ranks = RISK_TIERS.map(riskRank)

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  test('highestRisk picks the most dangerous tier in a workflow', () => {
    expect(highestRisk(['read', 'internal', 'external'])).toBe('external')
    expect(highestRisk(['read', 'financial', 'internal'])).toBe('financial')
  })

  test('highestRisk of an empty workflow is read', () => {
    expect(highestRisk([])).toBe('read')
  })
})
