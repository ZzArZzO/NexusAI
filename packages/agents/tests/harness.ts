import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createClient, type PrismaClient } from '@nexusai/db'
import { config } from 'dotenv'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

/**
 * This package gets its own test database.
 *
 * The integration suites TRUNCATE every table between tests, and turbo runs
 * package tests in parallel — so sharing one database meant `@nexusai/db`'s
 * reset wiped this suite's fixtures mid-test. The failures looked like
 * foreign-key bugs and moved around between runs, which is the worst kind.
 *
 * Derived rather than configured, so there is no second environment variable to
 * forget. `TEST_DATABASE_URL_AGENTS` overrides it if a different target is ever
 * needed.
 */
function agentsDatabaseUrl(): string | undefined {
  const explicit = process.env['TEST_DATABASE_URL_AGENTS']
  if (explicit) return explicit

  const base = process.env['TEST_DATABASE_URL']
  if (!base) return undefined

  return base.replace(/\/nexusai_test(\?|$)/, '/nexusai_test_agents$1')
}

const TEST_DATABASE_URL = agentsDatabaseUrl()

export const hasTestDatabase = Boolean(TEST_DATABASE_URL)

let client: PrismaClient | undefined

export function testPrisma(): PrismaClient {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set.')
  client ??= createClient(TEST_DATABASE_URL)
  return client
}

export function migrateTestDatabase(): void {
  if (!TEST_DATABASE_URL) return

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../../db', import.meta.url)),
    env: {
      ...process.env,
      DIRECT_DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_URL: TEST_DATABASE_URL,
    },
    stdio: 'pipe',
    shell: true,
  })
}

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

export interface AgentFixture {
  workspaceId: string
  departmentId: string
}

/**
 * A workspace with one department, configured the way the seed configures them.
 *
 * `tools` is deliberately the full Phase-1 allowlist rather than a minimal set:
 * a kernel test that only grants the tool it expects to be called proves less
 * than one where the model had options.
 */
export async function seedAgentFixture(options?: {
  autoApprove?: string[]
  tools?: string[]
}): Promise<AgentFixture> {
  const prisma = testPrisma()

  const workspace = await prisma.workspace.create({
    data: { slug: `agent-test-${Date.now()}`, name: 'Agent Test' },
  })

  const department = await prisma.department.create({
    data: {
      workspaceId: workspace.id,
      key: 'ceo',
      displayName: 'CEO',
      charter: 'You are the CEO. Cite memory. Never claim an action succeeded.',
      config: {
        create: {
          tools: options?.tools ?? [
            'memory.recall',
            'memory.write',
            'task.create',
            'task.update',
            'task.list',
            'goal.list',
            'report.generate',
          ],
          memoryScopes: ['company', 'ceo'],
          autoApprove: options?.autoApprove ?? ['read', 'internal'],
          maxSteps: 6,
        },
      },
    },
  })

  return { workspaceId: workspace.id, departmentId: department.id }
}
