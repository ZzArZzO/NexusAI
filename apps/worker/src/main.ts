import { toErrorMessage } from '@nexusai/core'
import { scopedLogger } from '@nexusai/core/logger'
import { getPrisma } from '@nexusai/db'

const log = scopedLogger('worker')

/**
 * Phase 0: the worker proves its lifecycle — it boots, verifies it can reach the
 * database, stays alive, and shuts down cleanly on a signal.
 *
 * Phase 2 attaches the Inngest function registry here so long-running department
 * workflows execute in this process rather than inside a serverless request.
 */
async function verifyDatabase(): Promise<void> {
  await getPrisma().$queryRaw`SELECT 1`
  log.info('database reachable')
}

/**
 * Resolves on the first SIGINT/SIGTERM. Awaiting it is what keeps the event loop
 * alive, so the process stays up without a busy timer.
 */
function untilShutdownSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const handle = (signal: NodeJS.Signals) => {
      process.off('SIGINT', handle)
      process.off('SIGTERM', handle)
      resolve(signal)
    }

    process.once('SIGINT', handle)
    process.once('SIGTERM', handle)
  })
}

async function main(): Promise<void> {
  log.info({ nodeEnv: process.env['NODE_ENV'] ?? 'development' }, 'worker starting')

  await verifyDatabase()
  log.info('worker ready — awaiting work')

  const signal = await untilShutdownSignal()
  log.info({ signal }, 'shutting down')

  await getPrisma().$disconnect()
  log.info('shutdown complete')
}

main().catch((error: unknown) => {
  log.fatal({ error: toErrorMessage(error) }, 'worker failed')
  process.exit(1)
})
