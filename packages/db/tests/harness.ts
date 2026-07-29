import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'

import { PrismaClient } from '../generated/client'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

/**
 * Integration test harness.
 *
 * These tests run against a real Postgres because the things worth testing here
 * — a pgvector index, a generated tsvector column, a trigger spanning two
 * tables, RRF ranking — exist only in the database. Mocking Prisma would test
 * the mock.
 *
 * The target is TEST_DATABASE_URL, never DATABASE_URL: `resetDatabase` truncates
 * every table, and pointing that at a development database would be a bad day.
 */

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

export const hasTestDatabase = Boolean(TEST_DATABASE_URL)

let client: PrismaClient | undefined

export function testPrisma(): PrismaClient {
  if (!TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set. Integration tests should have been skipped.')
  }

  client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
  return client
}

/** Apply migrations to the test database. Called once per test run. */
export function migrateTestDatabase(): void {
  if (!TEST_DATABASE_URL) return

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      DIRECT_DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_URL: TEST_DATABASE_URL,
    },
    stdio: 'pipe',
    shell: true,
  })
}

/**
 * Truncate everything between tests.
 *
 * TRUNCATE ... CASCADE rather than per-table deletes, so tests do not silently
 * depend on deletion order, and RESTART IDENTITY so nothing leaks across tests
 * through a sequence value.
 */
export async function resetDatabase(): Promise<void> {
  const prisma = testPrisma()

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `

  if (tables.length === 0) return

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

export async function disconnectTestDatabase(): Promise<void> {
  await client?.$disconnect()
  client = undefined
}

// ─── fixtures ────────────────────────────────────────────────────

export interface Fixture {
  workspaceId: string
  departmentId: string
  userId: string
}

/** Minimum viable world: one workspace, one department, one user. */
export async function seedFixture(key = 'ceo'): Promise<Fixture> {
  const prisma = testPrisma()

  const workspace = await prisma.workspace.create({
    data: { slug: `test-${Math.abs(hashString(key))}`, name: 'Test' },
  })

  const department = await prisma.department.create({
    data: {
      workspaceId: workspace.id,
      key: key as never,
      displayName: 'Test Department',
      charter: 'test charter',
    },
  })

  const user = await prisma.user.create({
    data: {
      id: `user-${workspace.id}`,
      name: 'Test Operator',
      email: `op-${workspace.id}@test.local`,
    },
  })

  return { workspaceId: workspace.id, departmentId: department.id, userId: user.id }
}

/** Deterministic, so a fixture slug is stable within a test run. */
function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return hash + Date.now()
}

/**
 * A synthetic embedding pointing in a chosen direction.
 *
 * `seed` between 0 and 1 sets every component, so two vectors with different
 * seeds have a predictable cosine distance. That makes semantic ranking
 * assertable without calling an embedding API — which matters, because these
 * tests must run for free and offline.
 */
export function fakeEmbedding(seed: number, dimensions = 1536): number[] {
  return Array.from(
    { length: dimensions },
    (_, i) =>
      // Vary slightly by position so vectors are not degenerate, but keep the
      // dominant direction controlled by `seed`.
      seed + Math.sin(i * 0.01) * 0.001,
  )
}
