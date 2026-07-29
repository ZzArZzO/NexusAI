import { fileURLToPath } from 'node:url'

import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'

import { PrismaClient } from '../generated/client'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

/**
 * Idempotent seed. Safe to run repeatedly — every write is an upsert, so this
 * doubles as a "bring my local database up to date" command.
 */
const DEFAULT_WORKSPACE = {
  slug: 'nexus',
  name: 'NexusAI',
} as const

const DEFAULT_SETTINGS = [
  {
    key: 'automation.paused',
    value: false,
    description:
      'Global kill switch. When true, every autonomous workflow halts before its first step.',
  },
  {
    key: 'automation.default_approval_timeout',
    value: '72h',
    description: 'How long an approval gate waits before expiring as rejected.',
  },
] as const

async function main(): Promise<void> {
  const connectionString = process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DIRECT_DATABASE_URL or DATABASE_URL must be set to seed the database.')
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

  try {
    const workspace = await prisma.workspace.upsert({
      where: { slug: DEFAULT_WORKSPACE.slug },
      update: { name: DEFAULT_WORKSPACE.name },
      create: { ...DEFAULT_WORKSPACE },
    })

    for (const setting of DEFAULT_SETTINGS) {
      await prisma.systemSetting.upsert({
        where: { workspaceId_key: { workspaceId: workspace.id, key: setting.key } },
        update: { value: setting.value, description: setting.description },
        create: {
          workspaceId: workspace.id,
          key: setting.key,
          value: setting.value,
          description: setting.description,
        },
      })
    }

    console.warn(`Seeded workspace "${workspace.slug}" with ${DEFAULT_SETTINGS.length} settings.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
