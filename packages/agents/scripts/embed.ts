import { fileURLToPath } from 'node:url'

import { createClient } from '@nexusai/db'
import { config } from 'dotenv'

import { backfillEmbeddings } from '../src/memory/index'
import { routerFromEnv } from '../src/models/router'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

/**
 * Bring long-term memory up to date.
 *
 * Seeding writes documents but does not chunk or embed them, because seeding
 * must work with no API key and cost nothing. Until this has run, memory
 * contains text that nothing can retrieve — which presents as an agent that
 * cheerfully answers "I don't have anything on that" about a document sitting
 * right there.
 *
 * Run it after `pnpm db:seed`, and again after adding a real API key: the second
 * run replaces mock vectors with real ones.
 */
async function main(): Promise<void> {
  const connectionString = process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set.')
  }

  const prisma = createClient(connectionString)
  const router = routerFromEnv()

  try {
    const workspaces = await prisma.workspace.findMany({ select: { id: true, slug: true } })

    if (workspaces.length === 0) {
      console.warn('No workspace found. Run `pnpm db:seed` first.')
      return
    }

    console.warn(
      router.embeddingLive
        ? '\nEmbedding with text-embedding-3-small.\n'
        : '\nNo OPENAI_API_KEY set — embedding with the deterministic mock.\n' +
            'Retrieval will work, but the rankings are not semantically meaningful.\n' +
            'Add the key and re-run to replace these vectors.\n',
    )

    for (const workspace of workspaces) {
      let documents = 0
      let chunks = 0

      // Loops until nothing is left: one pass handles a batch, and a large
      // corpus needs several.
      for (;;) {
        const result = await backfillEmbeddings({
          prisma,
          router,
          workspaceId: workspace.id,
          batchSize: 25,
        })

        documents += result.documentsIngested
        chunks += result.chunksEmbedded

        if (result.documentsIngested === 0 && result.chunksEmbedded === 0) break
      }

      const total = await prisma.memoryChunk.count({ where: { workspaceId: workspace.id } })

      console.warn(
        `  ${workspace.slug}: ${documents} documents chunked, ${chunks} chunks embedded, ${total} total`,
      )
    }

    console.warn('\nMemory is up to date.\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('\nEmbedding failed:', error)
  process.exit(1)
})
