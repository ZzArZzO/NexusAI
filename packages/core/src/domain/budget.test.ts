import { describe, expect, it } from 'vitest'

import {
  BUDGET_WARN_AT,
  budgetRefusalMessage,
  budgetStatus,
  formatBudget,
  MICROS_PER_DOLLAR,
  monthStart,
} from './budget'

const dollars = (amount: number) => amount * MICROS_PER_DOLLAR

describe('budgetStatus', () => {
  it('is unlimited when no limit is configured', () => {
    const status = budgetStatus(dollars(500), null)

    expect(status.state).toBe('unlimited')
    expect(status.blocksAutonomous).toBe(false)
    expect(status.remainingMicros).toBeNull()
  })

  it('is ok well under the limit', () => {
    const status = budgetStatus(dollars(10), dollars(50))

    expect(status.state).toBe('ok')
    expect(status.fraction).toBeCloseTo(0.2)
    expect(status.remainingMicros).toBe(dollars(40))
  })

  it('warns at the threshold without blocking', () => {
    const status = budgetStatus(dollars(40), dollars(50))

    expect(status.fraction).toBeCloseTo(BUDGET_WARN_AT)
    expect(status.state).toBe('warning')
    // Warning is information, not enforcement — work keeps running.
    expect(status.blocksAutonomous).toBe(false)
  })

  it('blocks exactly at the limit, not one micro-dollar past it', () => {
    // `>=`, deliberately: a limit of $50 means $50 is spent, not $50.000001.
    const status = budgetStatus(dollars(50), dollars(50))

    expect(status.state).toBe('exceeded')
    expect(status.blocksAutonomous).toBe(true)
    expect(status.remainingMicros).toBe(0)
  })

  it('treats a zero limit as no autonomous spending, not as unset', () => {
    const status = budgetStatus(0, 0)

    expect(status.state).toBe('exceeded')
    expect(status.blocksAutonomous).toBe(true)
    // The distinction matters: null is "no limit", 0 is "spend nothing".
    expect(status.limitMicros).toBe(0)
  })

  it('never reports negative remaining', () => {
    expect(budgetStatus(dollars(80), dollars(50)).remainingMicros).toBe(0)
  })
})

describe('formatBudget', () => {
  it('renders micro-dollars as money with two decimals', () => {
    expect(formatBudget(4_200_000)).toBe('$4.20')
    expect(formatBudget(0)).toBe('$0.00')
    // Sub-cent spend is real at these prices and must not render as nothing.
    expect(formatBudget(4_900)).toBe('$0.00')
    expect(formatBudget(12_345_678)).toBe('$12.35')
  })
})

describe('monthStart', () => {
  it('returns the first instant of the calendar month', () => {
    expect(monthStart(new Date('2026-07-30T14:22:00Z')).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    )
  })

  it('handles the first of the month without moving backwards', () => {
    expect(monthStart(new Date('2026-08-01T00:00:00Z')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    )
  })
})

describe('budgetRefusalMessage', () => {
  it('tells the model not to retry a cheaper version', () => {
    const message = budgetRefusalMessage(budgetStatus(dollars(51), dollars(50)))

    expect(message).toContain('$51.00')
    expect(message).toContain('$50.00')
    // Without this, a model told only "over budget" apologises and retries with a
    // shorter prompt — which spends more.
    expect(message).toMatch(/do not retry/i)
  })
})
