/**
 * Cost accounting.
 *
 * Prices are per million tokens, in micro-dollars, so all arithmetic is integer
 * and a month of runs cannot drift by floating-point rounding. Verified against
 * the published rate cards on 29 July 2026.
 */

export interface ModelPrice {
  /** Micro-dollars per million input tokens. */
  input: number
  output: number
  /** Cache reads are a tenth of input on the Claude API. */
  cacheRead: number
  /** 5-minute cache writes are 1.25x input. */
  cacheWrite: number
}

const USD = 1_000_000

export const PRICES: Record<string, ModelPrice> = {
  'claude-opus-5': {
    input: 5 * USD,
    output: 25 * USD,
    cacheRead: 0.5 * USD,
    cacheWrite: 6.25 * USD,
  },
  /**
   * Introductory pricing of $2/$10 runs until 31 August 2026, after which this
   * becomes the rate. Estimating at the higher number means the budget is never
   * a surprise in September.
   */
  'claude-sonnet-5': {
    input: 3 * USD,
    output: 15 * USD,
    cacheRead: 0.3 * USD,
    cacheWrite: 3.75 * USD,
  },
  'claude-haiku-4-5-20251001': {
    input: 1 * USD,
    output: 5 * USD,
    cacheRead: 0.1 * USD,
    cacheWrite: 1.25 * USD,
  },
  'text-embedding-3-small': {
    input: 0.02 * USD,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  /** The mock provider is free, and saying so explicitly keeps the maths honest. */
  mock: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

/** Cost of one model call, in micro-dollars. */
export function costMicros(modelId: string, usage: TokenUsage): number {
  const price = PRICES[modelId] ?? PRICES['mock']
  if (!price) return 0

  // Cached tokens are billed at the cache-read rate instead of the input rate,
  // so they must be subtracted from the input count rather than added on top.
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedTokens)

  return Math.round(
    (uncachedInput * price.input) / 1_000_000 +
      (usage.cachedTokens * price.cacheRead) / 1_000_000 +
      (usage.outputTokens * price.output) / 1_000_000,
  )
}

export function formatMicros(micros: number): string {
  return `$${(micros / USD).toFixed(4)}`
}
