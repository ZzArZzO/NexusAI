import { describe, expect, test } from 'vitest'

import { deterministicVector } from './mock'
import { EMBEDDING_DIMENSIONS, ModelRouter, PROFILES } from './router'

describe('ModelRouter', () => {
  test('falls back to the mock when no API key is present', () => {
    const router = new ModelRouter({})

    expect(router.live).toBe(false)
    expect(router.language('reasoning').live).toBe(false)
    expect(router.language('reasoning').modelId).toBe('mock')
  })

  test('reports live when a key is configured', () => {
    const router = new ModelRouter({ anthropicApiKey: 'sk-ant-test' })

    expect(router.live).toBe(true)
    expect(router.language('reasoning').modelId).toBe('claude-sonnet-5')
  })

  test('language and embedding providers are independent', () => {
    // An operator may have an Anthropic key but no OpenAI one. That must produce
    // real answers over mock embeddings, not refuse to start.
    const router = new ModelRouter({ anthropicApiKey: 'sk-ant-test' })

    expect(router.live).toBe(true)
    expect(router.embeddingLive).toBe(false)
    expect(router.embedding().modelId).toBe('mock')
  })

  test('the default profile is frugal', () => {
    const router = new ModelRouter({ anthropicApiKey: 'k' })

    expect(router.modelIdFor('reasoning')).toBe('claude-sonnet-5')
    expect(router.modelIdFor('bulk')).toBe('claude-haiku-4-5-20251001')
  })

  test('the capable profile puts reasoning on Opus', () => {
    const router = new ModelRouter({ anthropicApiKey: 'k', profile: 'capable' })

    expect(router.modelIdFor('reasoning')).toBe('claude-opus-5')
    // Drafting stays on Sonnet: paying Opus rates to write a tweet is the
    // spending mistake this indirection exists to prevent.
    expect(router.modelIdFor('drafting')).toBe('claude-sonnet-5')
  })

  test('a per-department override beats the profile', () => {
    const router = new ModelRouter({
      anthropicApiKey: 'k',
      overrides: { reasoning: 'claude-opus-5' },
    })

    expect(router.modelIdFor('reasoning')).toBe('claude-opus-5')
    expect(router.modelIdFor('drafting')).toBe('claude-sonnet-5')
  })

  test('an unknown profile falls back rather than throwing', () => {
    const router = new ModelRouter({ anthropicApiKey: 'k', profile: 'nonsense' })

    expect(router.modelIdFor('reasoning')).toBe('claude-sonnet-5')
  })

  test('every profile defines every role', () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      for (const role of ['reasoning', 'drafting', 'bulk'] as const) {
        expect(profile.models[role], `${name}.${role}`).toBeTruthy()
      }
    }
  })
})

describe('deterministicVector', () => {
  test('produces the configured number of dimensions', () => {
    expect(deterministicVector('anything')).toHaveLength(EMBEDDING_DIMENSIONS)
  })

  test('is stable for the same input', () => {
    expect(deterministicVector('pricing decision')).toEqual(deterministicVector('pricing decision'))
  })

  test('differs for different input', () => {
    expect(deterministicVector('alpha')).not.toEqual(deterministicVector('beta'))
  })

  test('is unit length, so cosine distance behaves', () => {
    const magnitude = Math.sqrt(
      deterministicVector('some text').reduce((total, x) => total + x * x, 0),
    )

    expect(magnitude).toBeCloseTo(1, 5)
  })

  test('handles empty input without producing NaN', () => {
    const vector = deterministicVector('')

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(vector.every((x) => Number.isFinite(x))).toBe(true)
  })
})
