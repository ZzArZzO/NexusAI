import { describe, expect, test } from 'vitest'

import { costMicros, formatMicros, PRICES } from './pricing'

describe('costMicros', () => {
  test('charges input and output at their own rates', () => {
    // Sonnet 5: $3/M input, $15/M output.
    const cost = costMicros('claude-sonnet-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedTokens: 0,
    })

    expect(cost).toBe(18 * 1_000_000)
  })

  test('bills cached tokens at the cache-read rate instead of the input rate', () => {
    // The subtlety worth testing: cached tokens are part of the input count, not
    // additional to it. Adding them on top would over-bill by roughly the cache
    // hit rate, which at 70% is most of the invoice.
    const allFresh = costMicros('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedTokens: 0,
    })

    const allCached = costMicros('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedTokens: 1_000_000,
    })

    expect(allFresh).toBe(5 * 1_000_000)
    expect(allCached).toBe(0.5 * 1_000_000)
    expect(allCached).toBeLessThan(allFresh)
  })

  test('a 70% cache hit rate costs what the arithmetic says', () => {
    const cost = costMicros('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedTokens: 700_000,
    })

    // 300k at $5/M + 700k at $0.50/M = $1.50 + $0.35
    expect(cost).toBe(1.85 * 1_000_000)
  })

  test('never returns a negative cost when a provider over-reports cached tokens', () => {
    const cost = costMicros('claude-sonnet-5', {
      inputTokens: 100,
      outputTokens: 0,
      cachedTokens: 5_000,
    })

    expect(cost).toBeGreaterThanOrEqual(0)
  })

  test('the mock provider is free', () => {
    expect(
      costMicros('mock', { inputTokens: 10_000_000, outputTokens: 10_000_000, cachedTokens: 0 }),
    ).toBe(0)
  })

  test('an unknown model falls back to free rather than throwing', () => {
    // A run must not fail because a new model id has not been priced yet — an
    // unpriced run is a reporting gap, not an outage.
    expect(
      costMicros('some-model-released-tomorrow', {
        inputTokens: 1000,
        outputTokens: 1000,
        cachedTokens: 0,
      }),
    ).toBe(0)
  })

  test('returns whole micro-dollars, never a float', () => {
    const cost = costMicros('claude-haiku-4-5-20251001', {
      inputTokens: 1234,
      outputTokens: 567,
      cachedTokens: 89,
    })

    expect(Number.isInteger(cost)).toBe(true)
  })
})

describe('price table', () => {
  test('output always costs more than input', () => {
    for (const [model, price] of Object.entries(PRICES)) {
      if (model === 'mock' || price.output === 0) continue
      expect(price.output, model).toBeGreaterThan(price.input)
    }
  })

  test('cache reads are cheaper than fresh input', () => {
    for (const [model, price] of Object.entries(PRICES)) {
      if (price.input === 0) continue
      expect(price.cacheRead, model).toBeLessThan(price.input)
    }
  })

  test('cache writes cost more than fresh input', () => {
    for (const [model, price] of Object.entries(PRICES)) {
      if (price.input === 0 || price.cacheWrite === 0) continue
      expect(price.cacheWrite, model).toBeGreaterThan(price.input)
    }
  })
})

describe('formatMicros', () => {
  test('renders micro-dollars as currency', () => {
    expect(formatMicros(1_850_000)).toBe('$1.8500')
    expect(formatMicros(0)).toBe('$0.0000')
  })
})
