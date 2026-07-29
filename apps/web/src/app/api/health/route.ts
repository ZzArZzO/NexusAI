import { prisma } from '@nexusai/db'
import { NextResponse } from 'next/server'

// No `export const dynamic` here: with `cacheComponents` enabled, route segment
// config is rejected. Route handlers are dynamic unless they opt into `use cache`.

type CheckStatus = 'ok' | 'degraded' | 'down'

interface HealthReport {
  status: CheckStatus
  version: string
  checks: Record<string, { status: CheckStatus; latencyMs: number; error?: string }>
}

async function timed(check: () => Promise<unknown>) {
  const startedAt = performance.now()
  try {
    await check()
    return { status: 'ok' as const, latencyMs: Math.round(performance.now() - startedAt) }
  } catch (error) {
    return {
      status: 'down' as const,
      latencyMs: Math.round(performance.now() - startedAt),
      // Surface the reason but never the connection string.
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
    }
  }
}

/**
 * Liveness + dependency check. Used by Docker healthchecks, the System Health
 * dashboard panel, and uptime monitoring.
 */
export async function GET() {
  const database = await timed(() => prisma.$queryRaw`SELECT 1`)

  const report: HealthReport = {
    status: database.status === 'ok' ? 'ok' : 'down',
    version: process.env['npm_package_version'] ?? '0.1.0',
    checks: { database },
  }

  return NextResponse.json(report, { status: report.status === 'ok' ? 200 : 503 })
}
