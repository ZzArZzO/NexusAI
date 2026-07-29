import { describe, expect, test } from 'vitest'

import { chunkDocument, embeddableText, estimateTokens } from './chunk'

describe('chunkDocument', () => {
  test('keeps a short document as one chunk', () => {
    const chunks = chunkDocument('A short note about pricing.')

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.content).toBe('A short note about pricing.')
  })

  test('tracks the heading path so a chunk knows what it is about', () => {
    const markdown = `
# Q3 plan

Some intro.

## Pricing

We settled on forty-nine euros.

## Hiring

Nobody yet.
`.trim()

    const chunks = chunkDocument(markdown)
    const pricing = chunks.find((chunk) => chunk.content.includes('forty-nine'))

    expect(pricing?.headings).toEqual(['Q3 plan', 'Pricing'])
  })

  test('starts a new chunk when the heading changes', () => {
    const markdown = '# A\n\nAlpha content.\n\n# B\n\nBeta content.'

    const chunks = chunkDocument(markdown)

    // Two topics in one chunk makes both retrieve worse, which is the whole
    // reason heading tracking exists.
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks.some((c) => c.content.includes('Alpha') && c.content.includes('Beta'))).toBe(
      false,
    )
  })

  test('splits a document that exceeds the token budget', () => {
    const paragraph = 'This is a sentence about the business. '.repeat(40)
    const markdown = `${paragraph}\n\n${paragraph}\n\n${paragraph}`

    const chunks = chunkDocument(markdown, { maxTokens: 100, overlapTokens: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      // Allow a little slack: a chunk closes when the *next* block would
      // overflow, so the last block can push slightly past the target.
      expect(chunk.tokenCount).toBeLessThanOrEqual(200)
    }
  })

  test('splits a single sentence longer than the entire budget', () => {
    const monster = `${'x'.repeat(4000)}.`

    const chunks = chunkDocument(monster, { maxTokens: 100, overlapTokens: 0 })

    expect(chunks.length).toBeGreaterThan(1)
  })

  test('overlaps adjacent chunks so a fact on the boundary stays findable', () => {
    const markdown = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} with some content.`).join(
      '\n\n',
    )

    const chunks = chunkDocument(markdown, { maxTokens: 60, overlapTokens: 20 })

    expect(chunks.length).toBeGreaterThan(1)

    const first = chunks[0]?.content ?? ''
    const second = chunks[1]?.content ?? ''

    // The property that matters is that text near the boundary appears on both
    // sides, so a sentence split across it is retrievable either way. Asserting
    // an exact character offset would just be restating the implementation.
    const boundaryText = first.slice(-25).trim()

    expect(boundaryText.length).toBeGreaterThan(0)
    expect(second).toContain(boundaryText)
  })

  test('no overlap is carried when the option is zero', () => {
    const markdown = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} with some content.`).join(
      '\n\n',
    )

    const chunks = chunkDocument(markdown, { maxTokens: 60, overlapTokens: 0 })

    const first = chunks[0]?.content ?? ''
    const second = chunks[1]?.content ?? ''

    expect(second).not.toContain(first.slice(-25).trim())
  })

  test('indexes are contiguous from zero', () => {
    const markdown = Array.from({ length: 20 }, (_, i) => `Block ${i}.`).join('\n\n')

    const chunks = chunkDocument(markdown, { maxTokens: 40, overlapTokens: 0 })

    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index))
  })

  test('ignores empty input', () => {
    expect(chunkDocument('')).toEqual([])
    expect(chunkDocument('   \n\n  ')).toEqual([])
  })

  test('does not drop content', () => {
    const markdown = '# Title\n\nFirst para.\n\nSecond para.\n\n## Sub\n\nThird para.'

    const joined = chunkDocument(markdown, { overlapTokens: 0 })
      .map((chunk) => chunk.content)
      .join(' ')

    for (const fragment of ['First para.', 'Second para.', 'Third para.']) {
      expect(joined).toContain(fragment)
    }
  })
})

describe('embeddableText', () => {
  test('prepends the heading path so context travels with the chunk', () => {
    const text = embeddableText({
      index: 0,
      content: 'We settled on forty-nine euros.',
      headings: ['Q3 plan', 'Pricing'],
      tokenCount: 8,
    })

    // This is most of why heading tracking is worth the complexity: the chunk
    // never says "pricing", but what gets embedded does.
    expect(text).toBe('Q3 plan > Pricing\n\nWe settled on forty-nine euros.')
  })

  test('omits the prefix when there are no headings', () => {
    const text = embeddableText({ index: 0, content: 'Plain note.', headings: [], tokenCount: 3 })

    expect(text).toBe('Plain note.')
  })
})

describe('estimateTokens', () => {
  test('scales with length', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })
})
