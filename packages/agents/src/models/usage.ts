import type { LanguageModelUsage } from 'ai'

import type { TokenUsage } from './pricing'

/**
 * Normalise the SDK's usage report.
 *
 * Every field on `LanguageModelUsage` is `number | undefined`, because not every
 * provider reports every figure. Reading them defensively in one place means a
 * provider that omits cache detail produces a slightly conservative cost rather
 * than a `NaN` that silently poisons the month's total.
 */
export function toTokenUsage(usage: LanguageModelUsage | undefined): TokenUsage {
  const inputTokens = usage?.inputTokens ?? 0
  const cachedTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0

  return {
    inputTokens,
    outputTokens: usage?.outputTokens ?? 0,
    // Clamped: a provider reporting more cached than total input would
    // otherwise produce a negative uncached count and an under-estimated bill.
    cachedTokens: Math.min(cachedTokens, inputTokens),
  }
}
