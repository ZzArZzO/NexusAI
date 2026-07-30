import { fileURLToPath } from 'node:url'

import { createClient } from '@nexusai/db'
import { config } from 'dotenv'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

/**
 * Send an event by hand.
 *
 * Exists so orchestration can be exercised without waiting for a cron or clicking
 * through the UI — which is the difference between "the workflow is wired up" and
 * "the workflow ran and I watched it".
 *
 *   pnpm jobs:trigger department ceo "What should I focus on this week?"
 *   pnpm jobs:trigger campaign "Launch the beta to the waitlist"
 */
async function main(): Promise<void> {
  const { inngest } = await import('../src/client')
  const { CampaignRequested, DepartmentRun } = await import('../src/events')

  const [kind, ...rest] = process.argv.slice(2)

  const connectionString = process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL']
  if (!connectionString) throw new Error('DATABASE_URL must be set.')

  const prisma = createClient(connectionString)

  try {
    const workspace = await prisma.workspace.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true },
    })

    if (kind === 'department') {
      const [department, ...words] = rest
      const objective = words.join(' ')

      if (!department || objective === '') {
        throw new Error('Usage: jobs:trigger department <key> "<objective>"')
      }

      const result = await inngest.send(
        DepartmentRun.create({
          workspaceId: workspace.id,
          department: department as never,
          objective,
          trigger: 'manual',
        }),
      )

      console.warn(`Sent nexus/department.run to ${department}`)
      console.warn(`  event ids: ${result.ids.join(', ')}`)
      return
    }

    if (kind === 'campaign') {
      const brief = rest.join(' ')
      if (brief.length < 10) throw new Error('Usage: jobs:trigger campaign "<brief>"')

      const result = await inngest.send(
        CampaignRequested.create({ workspaceId: workspace.id, brief }),
      )

      console.warn('Sent nexus/campaign.requested')
      console.warn(`  event ids: ${result.ids.join(', ')}`)
      console.warn('  it will park on an approval — decide it at /approvals')
      return
    }

    throw new Error('Usage: jobs:trigger <department|campaign> …')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('\nTrigger failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
