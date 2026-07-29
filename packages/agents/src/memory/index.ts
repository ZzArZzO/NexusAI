import { createHash } from 'node:crypto'

import { memory as memoryRepo, type PrismaClient, type RetrievedChunk } from '@nexusai/db'
import { embedMany } from 'ai'

import type { ModelRouter } from '../models/router'
import { chunkDocument, embeddableText, type ChunkOptions } from './chunk'

export * from './chunk'

/**
 * Memory ingestion and recall.
 *
 * Ingestion is deliberately idempotent on content hash: re-running the seed, or
 * re-saving an unchanged note, must not produce a second copy that then competes
 * with the original in every search result.
 */

export interface IngestParams {
  prisma: PrismaClient
  router: ModelRouter
  workspaceId: string
  departmentId?: string | undefined
  kind:
    | 'note'
    | 'document'
    | 'conversation'
    | 'meeting'
    | 'report'
    | 'research'
    | 'email'
    | 'web'
    | 'code'
  title: string
  content: string
  scopes: string[]
  sourceRef?: string | undefined
  chunkOptions?: ChunkOptions | undefined
}

export interface IngestResult {
  documentId: string
  chunks: number
  /** False when the identical content was already stored, so nothing was re-embedded. */
  changed: boolean
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function ingest(params: IngestParams): Promise<IngestResult> {
  const { prisma, router, workspaceId, content } = params
  const contentHash = hashContent(content)

  const existing = await prisma.memoryDocument.findUnique({
    where: { workspaceId_contentHash: { workspaceId, contentHash } },
    select: { id: true, ingestedAt: true },
  })

  if (existing?.ingestedAt) {
    // Identical text, already chunked and embedded. Embedding it again would
    // cost money and change nothing.
    const chunks = await prisma.memoryChunk.count({ where: { documentId: existing.id } })
    return { documentId: existing.id, chunks, changed: false }
  }

  const document = await prisma.memoryDocument.upsert({
    where: { workspaceId_contentHash: { workspaceId, contentHash } },
    update: { title: params.title, scopes: params.scopes },
    create: {
      workspaceId,
      kind: params.kind,
      title: params.title,
      content,
      contentHash,
      scopes: params.scopes,
      ...(params.departmentId === undefined ? {} : { departmentId: params.departmentId }),
      ...(params.sourceRef === undefined ? {} : { sourceRef: params.sourceRef }),
    },
    select: { id: true },
  })

  const chunks = chunkDocument(content, params.chunkOptions ?? {})
  if (chunks.length === 0) {
    return { documentId: document.id, chunks: 0, changed: true }
  }

  const { model } = router.embedding()

  // One batched call rather than one per chunk: embedding APIs charge per token
  // either way, but the round trips dominate wall-clock for a large document.
  const { embeddings } = await embedMany({
    model,
    values: chunks.map(embeddableText),
  })

  await memoryRepo.replaceDocumentChunks(prisma, {
    workspaceId,
    documentId: document.id,
    chunks: chunks.map((chunk, index) => ({
      index: chunk.index,
      content: chunk.content,
      headings: chunk.headings,
      tokenCount: chunk.tokenCount,
      scopes: params.scopes,
      embedding: embeddings[index] ?? [],
      metadata: { title: params.title },
    })),
  })

  return { documentId: document.id, chunks: chunks.length, changed: true }
}

export interface RecallParams {
  prisma: PrismaClient
  router: ModelRouter
  workspaceId: string
  query: string
  scopes?: string[] | undefined
  limit?: number | undefined
}

/**
 * Retrieve by meaning and by exact term at once.
 *
 * The query is embedded with the same model the chunks were, which is the
 * constraint that makes changing the embedding model a re-embed rather than a
 * config change.
 */
export async function recall(params: RecallParams): Promise<RetrievedChunk[]> {
  const { model } = params.router.embedding()

  const { embeddings } = await embedMany({ model, values: [params.query] })
  const embedding = embeddings[0]

  if (!embedding) return []

  return memoryRepo.hybridSearch(params.prisma, {
    workspaceId: params.workspaceId,
    query: params.query,
    embedding,
    scopes: params.scopes ?? [],
    limit: params.limit ?? 6,
  })
}

/**
 * Render retrieved chunks for a prompt.
 *
 * Each carries an explicit citation marker, because the charters require the
 * agent to cite what it used and it cannot do that if the context arrives as
 * anonymous prose.
 */
export function renderForPrompt(chunks: readonly RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'Long-term memory returned nothing for this query. Say so rather than inventing detail.'
  }

  return chunks
    .map((chunk, index) => {
      const path = chunk.headings.length > 0 ? ` — ${chunk.headings.join(' > ')}` : ''
      return `[${index + 1}]${path}\n${chunk.content}`
    })
    .join('\n\n---\n\n')
}

export interface BackfillResult {
  /** Documents that had never been chunked — the state the seed leaves them in. */
  documentsIngested: number
  /** Chunks that existed but had no vector. */
  chunksEmbedded: number
}

/**
 * Bring memory up to date.
 *
 * Two distinct gaps, both real:
 *
 *  1. Documents the seed wrote without chunking, because seeding must work with
 *     no API key and cost nothing.
 *  2. Chunks whose embedding failed or was skipped.
 *
 * Run after seeding, and again after adding a real API key — that second run is
 * what converts a mock-embedded corpus into a properly embedded one.
 */
export async function backfillEmbeddings(params: {
  prisma: PrismaClient
  router: ModelRouter
  workspaceId: string
  batchSize?: number
}): Promise<BackfillResult> {
  const batchSize = params.batchSize ?? 50
  const { prisma, router, workspaceId } = params

  const unchunked = await prisma.memoryDocument.findMany({
    where: { workspaceId, ingestedAt: null },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  })

  for (const document of unchunked) {
    await ingest({
      prisma,
      router,
      workspaceId,
      kind: document.kind,
      title: document.title,
      content: document.content,
      scopes: document.scopes,
      ...(document.departmentId === null ? {} : { departmentId: document.departmentId }),
      ...(document.sourceRef === null ? {} : { sourceRef: document.sourceRef }),
    })
  }

  const pending = await memoryRepo.findChunksWithoutEmbedding(prisma, {
    workspaceId,
    limit: batchSize,
  })

  if (pending.length > 0) {
    const { model } = router.embedding()
    const { embeddings } = await embedMany({ model, values: pending.map((c) => c.content) })

    for (const [index, chunk] of pending.entries()) {
      const embedding = embeddings[index]
      if (!embedding) continue
      await memoryRepo.setChunkEmbedding(prisma, { chunkId: chunk.id, embedding })
    }
  }

  return { documentsIngested: unchunked.length, chunksEmbedded: pending.length }
}
