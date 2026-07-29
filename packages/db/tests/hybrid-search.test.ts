import { createHash } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { hybridSearch, replaceDocumentChunks } from '../src/repositories/memory'
import {
  disconnectTestDatabase,
  fakeEmbedding,
  hasTestDatabase,
  migrateTestDatabase,
  resetDatabase,
  seedFixture,
  testPrisma,
  type Fixture,
} from './harness'

/**
 * Hybrid retrieval.
 *
 * The claim being tested is specific: fusing keyword and vector search finds
 * things that either one alone would miss. Two chunks make that provable —
 * one that only keyword search can find, one that only vector search can find —
 * and a correct implementation returns both.
 */
describe.skipIf(!hasTestDatabase)('hybrid search', () => {
  let fixture: Fixture
  let documentId: string

  /** Near-identical to the query vector, so it wins on the semantic side. */
  const SEMANTIC_MATCH = fakeEmbedding(0.02)
  /** Far from the query vector, so it can only be found by keyword. */
  const SEMANTIC_MISS = fakeEmbedding(0.9)
  const QUERY_VECTOR = fakeEmbedding(0.02)

  beforeAll(() => {
    migrateTestDatabase()
  })

  beforeEach(async () => {
    await resetDatabase()
    fixture = await seedFixture('research')

    const prisma = testPrisma()
    const content = 'seed corpus'
    const document = await prisma.memoryDocument.create({
      data: {
        workspaceId: fixture.workspaceId,
        kind: 'note',
        title: 'Pricing decision',
        content,
        contentHash: createHash('sha256').update(content).digest('hex'),
        scopes: ['company'],
      },
    })
    documentId = document.id

    await replaceDocumentChunks(prisma, {
      workspaceId: fixture.workspaceId,
      documentId,
      chunks: [
        {
          // Contains the literal query term. Vector-distant.
          index: 0,
          content: 'Our pricing was reviewed against three competitors last quarter.',
          headings: ['Pricing'],
          tokenCount: 11,
          scopes: ['company'],
          embedding: SEMANTIC_MISS,
        },
        {
          // Never says "pricing". Vector-near.
          index: 1,
          content: 'We settled on forty-nine euros a month for the standard tier.',
          headings: ['Decision'],
          tokenCount: 12,
          scopes: ['company'],
          embedding: SEMANTIC_MATCH,
        },
        {
          // Unrelated on both axes. Should not surface.
          index: 2,
          content: 'The office plant needs watering on Thursdays.',
          headings: ['Misc'],
          tokenCount: 8,
          scopes: ['company'],
          embedding: fakeEmbedding(0.5),
        },
      ],
    })
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  test('returns the keyword match even when it is semantically distant', async () => {
    const results = await hybridSearch(testPrisma(), {
      workspaceId: fixture.workspaceId,
      query: 'pricing',
      embedding: QUERY_VECTOR,
      scopes: ['company'],
    })

    const keywordHit = results.find((r) => r.content.includes('reviewed against three competitors'))

    expect(keywordHit).toBeDefined()
    expect(keywordHit?.ftsRank).toBe(1)
  })

  test('returns the semantic match even though it never uses the query term', async () => {
    const results = await hybridSearch(testPrisma(), {
      workspaceId: fixture.workspaceId,
      query: 'pricing',
      embedding: QUERY_VECTOR,
      scopes: ['company'],
    })

    const semanticHit = results.find((r) => r.content.includes('forty-nine euros'))

    // This is the whole argument for hybrid search: the chunk that actually
    // answers "what did we decide about pricing" contains no form of the word.
    expect(semanticHit).toBeDefined()
    expect(semanticHit?.content).not.toMatch(/pricing/i)
    expect(semanticHit?.ftsRank).toBeNull()
    expect(semanticHit?.semanticRank).toBe(1)
  })

  test('scores are ordered descending', async () => {
    const results = await hybridSearch(testPrisma(), {
      workspaceId: fixture.workspaceId,
      query: 'pricing',
      embedding: QUERY_VECTOR,
    })

    const scores = results.map((r) => r.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  test('a chunk matching both signals outranks one matching only the semantic signal', async () => {
    const prisma = testPrisma()

    // Note what is *not* asserted here. When two chunks both match the keyword,
    // their fused scores can legitimately tie: RRF sums 1/(k+rank) over the two
    // lists, and swapping ranks 1 and 2 between the lists produces the same
    // total. Ordering within a tie is arbitrary and testing it would be testing
    // an implementation detail.
    //
    // What RRF does guarantee is that appearing in both candidate lists beats
    // appearing in one, which is the property this asserts.
    await replaceDocumentChunks(prisma, {
      workspaceId: fixture.workspaceId,
      documentId,
      chunks: [
        {
          index: 0,
          content: 'Pricing: we settled on forty-nine euros a month.',
          headings: [],
          tokenCount: 9,
          scopes: ['company'],
          embedding: SEMANTIC_MATCH, // contains the term AND is nearest in vector space
        },
        {
          index: 1,
          content: 'The standard tier costs less than a lunch.',
          headings: [],
          tokenCount: 9,
          scopes: ['company'],
          embedding: fakeEmbedding(0.03), // semantically close, no keyword match
        },
      ],
    })

    const results = await hybridSearch(prisma, {
      workspaceId: fixture.workspaceId,
      query: 'pricing',
      embedding: QUERY_VECTOR,
    })

    expect(results[0]?.content).toContain('forty-nine euros')
    expect(results[0]?.ftsRank).not.toBeNull()
    expect(results[0]?.semanticRank).not.toBeNull()

    const semanticOnly = results.find((r) => r.content.includes('lunch'))
    expect(semanticOnly?.ftsRank).toBeNull()
    expect(results[0]?.score).toBeGreaterThan(semanticOnly?.score ?? Infinity)
  })

  test('scope filtering excludes chunks the department may not read', async () => {
    const results = await hybridSearch(testPrisma(), {
      workspaceId: fixture.workspaceId,
      query: 'pricing',
      embedding: QUERY_VECTOR,
      scopes: ['finance-only'],
    })

    expect(results).toHaveLength(0)
  })

  test('an empty scope list searches everything', async () => {
    const results = await hybridSearch(testPrisma(), {
      workspaceId: fixture.workspaceId,
      query: 'pricing',
      embedding: QUERY_VECTOR,
      scopes: [],
    })

    expect(results.length).toBeGreaterThan(0)
  })

  test('another workspace cannot see these chunks', async () => {
    const other = await seedFixture('finance')

    const results = await hybridSearch(testPrisma(), {
      workspaceId: other.workspaceId,
      query: 'pricing',
      embedding: QUERY_VECTOR,
    })

    expect(results).toHaveLength(0)
  })

  test('weighting can favour exact terms over meaning', async () => {
    const prisma = testPrisma()

    const keywordFirst = await hybridSearch(prisma, {
      workspaceId: fixture.workspaceId,
      query: 'pricing',
      embedding: QUERY_VECTOR,
      fullTextWeight: 10,
      semanticWeight: 0.1,
    })

    // With the keyword signal dominant, the chunk containing the literal term
    // must lead — this is the knob to reach for when searching invoice numbers,
    // people or flags rather than concepts.
    expect(keywordFirst[0]?.ftsRank).toBe(1)
  })

  test('replacing chunks removes the previous version', async () => {
    const prisma = testPrisma()

    await replaceDocumentChunks(prisma, {
      workspaceId: fixture.workspaceId,
      documentId,
      chunks: [
        {
          index: 0,
          content: 'Completely different pricing content now.',
          headings: [],
          tokenCount: 6,
          scopes: ['company'],
          embedding: SEMANTIC_MATCH,
        },
      ],
    })

    const remaining = await prisma.memoryChunk.count({ where: { documentId } })
    expect(remaining).toBe(1)

    const results = await hybridSearch(prisma, {
      workspaceId: fixture.workspaceId,
      query: 'watering plant Thursdays',
      embedding: fakeEmbedding(0.5),
    })

    expect(results.every((r) => !r.content.includes('watering'))).toBe(true)
  })

  test('rejects an embedding of the wrong dimension', async () => {
    await expect(
      hybridSearch(testPrisma(), {
        workspaceId: fixture.workspaceId,
        query: 'pricing',
        embedding: [0.1, 0.2, 0.3],
      }),
    ).rejects.toThrow(/1536 dimensions/)
  })
})
