import type { PrismaClient } from '../client'

export interface RetrievedChunk {
  id: string
  documentId: string
  chunkIndex: number
  content: string
  headings: string[]
  scopes: string[]
  metadata: unknown
  tokenCount: number
  /** Fused Reciprocal Rank Fusion score. Comparable within one result set only. */
  score: number
  /** Rank in the full-text candidate list, or null if keyword search missed it. */
  ftsRank: number | null
  /** Rank in the vector candidate list, or null if it fell outside the pool. */
  semanticRank: number | null
}

/** Raw row shape returned by the `nexus_hybrid_search` function. */
interface HybridSearchRow {
  id: string
  document_id: string
  chunk_index: number
  content: string
  headings: string[]
  scopes: string[]
  metadata: unknown
  token_count: number
  score: number
  fts_rank: number | null
  semantic_rank: number | null
}

export interface HybridSearchOptions {
  workspaceId: string
  /** Natural-language query. Drives the full-text half. */
  query: string
  /** Query embedding, 1536 dimensions. Drives the semantic half. */
  embedding: number[]
  /** Restrict to these memory scopes. Empty or omitted searches everything. */
  scopes?: string[]
  limit?: number
  /**
   * Relative weight of each signal in the fusion. Raise `fullTextWeight` when
   * exact terms matter (invoice numbers, people, flags); raise
   * `semanticWeight` when the question is conceptual.
   */
  fullTextWeight?: number
  semanticWeight?: number
}

const EMBEDDING_DIMENSIONS = 1536

/** pgvector's text input format: `[0.1,0.2,...]`. */
function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding must have ${EMBEDDING_DIMENSIONS} dimensions, received ${embedding.length}. ` +
        'A mismatch here means the embedding model changed — stored vectors would need regenerating.',
    )
  }
  return `[${embedding.join(',')}]`
}

/**
 * Retrieve memory by meaning and by exact term at once.
 *
 * Neither signal is sufficient alone: vector search misses literal tokens like a
 * person's name or an invoice number, and keyword search misses paraphrase. The
 * database function fuses both by rank (Reciprocal Rank Fusion) rather than by
 * score, because a cosine distance and a `ts_rank` are not on comparable scales.
 */
export async function hybridSearch(
  prisma: PrismaClient,
  options: HybridSearchOptions,
): Promise<RetrievedChunk[]> {
  const {
    workspaceId,
    query,
    embedding,
    scopes = [],
    limit = 10,
    fullTextWeight = 1,
    semanticWeight = 1,
  } = options

  const rows = await prisma.$queryRaw<HybridSearchRow[]>`
    SELECT * FROM nexus_hybrid_search(
      ${workspaceId}::uuid,
      ${query}::text,
      ${toVectorLiteral(embedding)}::vector,
      ${scopes}::text[],
      ${limit}::int,
      ${fullTextWeight}::float,
      ${semanticWeight}::float
    )
  `

  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    headings: row.headings,
    scopes: row.scopes,
    metadata: row.metadata,
    tokenCount: row.token_count,
    score: Number(row.score),
    ftsRank: row.fts_rank,
    semanticRank: row.semantic_rank,
  }))
}

export interface ChunkInput {
  index: number
  content: string
  headings: string[]
  tokenCount: number
  embedding: number[]
  scopes: string[]
  metadata?: Record<string, unknown>
}

/**
 * Replace a document's chunks in one transaction.
 *
 * Prisma cannot write a `vector` column, so chunks go in through raw SQL. The
 * delete-then-insert is deliberate: re-ingesting a changed document must not
 * leave orphaned chunks from the previous version behind, and doing both inside
 * one transaction means a search can never observe a half-replaced document.
 */
export async function replaceDocumentChunks(
  prisma: PrismaClient,
  params: { workspaceId: string; documentId: string; chunks: ChunkInput[] },
): Promise<number> {
  const { workspaceId, documentId, chunks } = params

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM memory_chunk WHERE document_id = ${documentId}::uuid`

    for (const chunk of chunks) {
      await tx.$executeRaw`
        INSERT INTO memory_chunk
          (id, workspace_id, document_id, "index", content, headings, token_count, scopes, metadata, embedding)
        VALUES (
          gen_random_uuid(),
          ${workspaceId}::uuid,
          ${documentId}::uuid,
          ${chunk.index}::int,
          ${chunk.content}::text,
          ${chunk.headings}::text[],
          ${chunk.tokenCount}::int,
          ${chunk.scopes}::text[],
          ${JSON.stringify(chunk.metadata ?? {})}::jsonb,
          ${toVectorLiteral(chunk.embedding)}::vector
        )
      `
    }

    await tx.memoryDocument.update({
      where: { id: documentId },
      data: { ingestedAt: new Date() },
    })

    return chunks.length
  })
}

/** Chunks awaiting an embedding, oldest first. Drives the backfill job. */
export async function findChunksWithoutEmbedding(
  prisma: PrismaClient,
  params: { workspaceId: string; limit?: number },
): Promise<{ id: string; content: string }[]> {
  return prisma.$queryRaw<{ id: string; content: string }[]>`
    SELECT id, content
    FROM memory_chunk
    WHERE workspace_id = ${params.workspaceId}::uuid
      AND embedding IS NULL
    ORDER BY created_at
    LIMIT ${params.limit ?? 100}::int
  `
}

export async function setChunkEmbedding(
  prisma: PrismaClient,
  params: { chunkId: string; embedding: number[] },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE memory_chunk
    SET embedding = ${toVectorLiteral(params.embedding)}::vector
    WHERE id = ${params.chunkId}::uuid
  `
}

/**
 * Which runs cited a given chunk. Powers the "used in N runs" backlink in the
 * memory browser, and answers "did the agent actually read this?".
 */
export async function findRunsCitingChunk(
  prisma: PrismaClient,
  params: { chunkId: string; limit?: number },
): Promise<{ runId: string; stepIndex: number; startedAt: Date }[]> {
  const rows = await prisma.$queryRaw<{ run_id: string; index: number; started_at: Date }[]>`
    SELECT run_id, "index", started_at
    FROM run_step
    WHERE ${params.chunkId} = ANY(cited_chunk_ids)
    ORDER BY started_at DESC
    LIMIT ${params.limit ?? 25}::int
  `

  return rows.map((row) => ({
    runId: row.run_id,
    stepIndex: row.index,
    startedAt: row.started_at,
  }))
}

export { EMBEDDING_DIMENSIONS }
