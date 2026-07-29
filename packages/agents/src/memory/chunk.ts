/**
 * Structure-aware chunking.
 *
 * Splitting on a fixed character count is the obvious approach and the wrong
 * one: it cuts sentences in half, separates a heading from the paragraph it
 * introduces, and produces chunks that retrieve well and read badly. Since the
 * retrieved text is pasted into a prompt and cited back to the operator, the
 * chunk boundary is a legibility decision, not just an indexing one.
 *
 * This splits on markdown structure first, falls back to paragraphs, then to
 * sentences, and only cuts mid-sentence when a single sentence exceeds the
 * budget entirely.
 */

export interface Chunk {
  index: number
  content: string
  /** Heading path at this point, e.g. ['Q3 plan', 'Pricing']. Carried into the prompt. */
  headings: string[]
  tokenCount: number
}

export interface ChunkOptions {
  /** Target size. Roughly 800 tokens keeps a chunk readable and a top-5 recall affordable. */
  maxTokens?: number
  /** Overlap between adjacent chunks, so a fact split across a boundary is still findable. */
  overlapTokens?: number
}

const DEFAULT_MAX_TOKENS = 800
const DEFAULT_OVERLAP_TOKENS = 80

/**
 * Token estimate.
 *
 * Deliberately an estimate: importing a real tokenizer to decide chunk
 * boundaries costs a dependency and startup time for precision that changes
 * nothing — a chunk of 780 or 820 tokens behaves identically. ~4 characters per
 * token is the standard English approximation, and the newer Claude tokenizer
 * runs higher, so this errs toward smaller chunks rather than larger.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

interface Block {
  text: string
  headings: string[]
}

/** Split into blocks, tracking the heading path each one sits under. */
function toBlocks(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: Block[] = []
  const headingStack: string[] = []

  let buffer: string[] = []

  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text !== '') blocks.push({ text, headings: [...headingStack] })
    buffer = []
  }

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)

    if (heading) {
      flush()
      const depth = heading[1]?.length ?? 1
      const title = heading[2]?.trim() ?? ''
      headingStack.length = Math.max(0, depth - 1)
      headingStack[depth - 1] = title
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }

    buffer.push(line)
  }

  flush()
  return blocks
}

function splitSentences(text: string): string[] {
  // Split after ., ! or ? followed by whitespace. Imperfect on abbreviations,
  // which costs nothing here: a slightly early boundary is not a defect.
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '')
}

/** Hard split for a single sentence longer than the whole budget. */
function splitLongText(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4
  const parts: string[] = []

  for (let i = 0; i < text.length; i += maxChars) {
    parts.push(text.slice(i, i + maxChars))
  }

  return parts
}

export function chunkDocument(markdown: string, options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS

  const blocks = toBlocks(markdown)
  const chunks: Chunk[] = []

  let current: string[] = []
  let currentHeadings: string[] = []
  let currentTokens = 0

  const push = () => {
    const content = current.join('\n\n').trim()
    if (content === '') return

    chunks.push({
      index: chunks.length,
      content,
      headings: [...currentHeadings],
      tokenCount: estimateTokens(content),
    })

    // Carry the tail forward, so a sentence that straddles the boundary is
    // retrievable from either side.
    if (overlapTokens > 0) {
      const tail = content.slice(-overlapTokens * 4)
      current = [tail]
      currentTokens = estimateTokens(tail)
    } else {
      current = []
      currentTokens = 0
    }
  }

  for (const block of blocks) {
    // A heading change is a natural boundary: keeping two topics in one chunk
    // makes both retrieve worse.
    const headingChanged = block.headings.join('>') !== currentHeadings.join('>')
    if (headingChanged && currentTokens > 0) {
      push()
      current = []
      currentTokens = 0
    }
    currentHeadings = block.headings

    const blockTokens = estimateTokens(block.text)

    if (blockTokens > maxTokens) {
      if (currentTokens > 0) push()

      for (const sentence of splitSentences(block.text)) {
        const sentenceTokens = estimateTokens(sentence)

        if (sentenceTokens > maxTokens) {
          for (const part of splitLongText(sentence, maxTokens)) {
            current = [part]
            currentTokens = estimateTokens(part)
            push()
          }
          continue
        }

        if (currentTokens + sentenceTokens > maxTokens) push()
        current.push(sentence)
        currentTokens += sentenceTokens
      }
      continue
    }

    if (currentTokens + blockTokens > maxTokens) push()

    current.push(block.text)
    currentTokens += blockTokens
  }

  // Final flush without overlap carry-over.
  const content = current.join('\n\n').trim()
  if (content !== '') {
    chunks.push({
      index: chunks.length,
      content,
      headings: [...currentHeadings],
      tokenCount: estimateTokens(content),
    })
  }

  return chunks.map((chunk, index) => ({ ...chunk, index }))
}

/**
 * The text actually embedded.
 *
 * The heading path is prepended so a chunk reading "we settled on forty-nine
 * euros" embeds as part of "Pricing decision", which is most of why heading
 * tracking is worth the complexity.
 */
export function embeddableText(chunk: Chunk): string {
  return chunk.headings.length > 0
    ? `${chunk.headings.join(' > ')}\n\n${chunk.content}`
    : chunk.content
}
