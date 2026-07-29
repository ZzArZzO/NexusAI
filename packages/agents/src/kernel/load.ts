import { DEPARTMENTS, type DepartmentId, type RiskTier } from '@nexusai/core'
import { SETTING, workspaces, type PrismaClient } from '@nexusai/db'

import type { ModelRole, ModelRouter } from '../models/router'
import { routerFromEnv } from '../models/router'
import { DEFAULT_TOOLS } from '../tools/builtin'
import { DepartmentAgent, type DepartmentSpec } from './agent'

/**
 * Assemble an agent from its database row.
 *
 * The charter, tool allowlist and model routing live in the database so they can
 * be edited without a deploy. Everything falls back to a code default, so a
 * department row written before a new field existed still produces a working
 * agent rather than a crash.
 */

const RISK_TIERS = new Set<string>(['read', 'internal', 'external', 'financial'])

function parseStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) return [...fallback]
  return value.filter((item): item is string => typeof item === 'string')
}

function parseRiskTiers(value: unknown): RiskTier[] {
  const parsed = parseStringArray(value, ['read', 'internal']).filter((tier) =>
    RISK_TIERS.has(tier),
  ) as RiskTier[]

  // 'financial' must never be auto-approved, whatever the row says. A bad edit
  // to a JSON column should not be able to authorise spending money.
  return parsed.filter((tier) => tier !== 'financial')
}

function parseModelOverrides(value: unknown): Partial<Record<ModelRole, string>> {
  if (typeof value !== 'object' || value === null) return {}

  const result: Partial<Record<ModelRole, string>> = {}
  for (const role of ['reasoning', 'drafting', 'bulk'] as const) {
    const model = (value as Record<string, unknown>)[role]
    if (typeof model === 'string' && model !== '') result[role] = model
  }
  return result
}

export interface LoadAgentParams {
  prisma: PrismaClient
  workspaceId: string
  department: DepartmentId
  router?: ModelRouter
}

export async function loadAgent(params: LoadAgentParams): Promise<DepartmentAgent> {
  const { prisma, workspaceId, department } = params

  const row = await prisma.department.findUnique({
    where: { workspaceId_key: { workspaceId, key: department } },
    include: { config: true },
  })

  if (!row) {
    throw new Error(
      `Department "${department}" does not exist in this workspace. Run \`pnpm db:seed\`.`,
    )
  }

  if (!row.enabled) {
    throw new Error(`Department "${department}" is disabled.`)
  }

  const overrides = parseModelOverrides(row.config?.models)
  const router = params.router ?? routerFromEnv(overrides)

  const timeout = await workspaces.getSetting<string>(prisma, {
    workspaceId,
    key: SETTING.defaultApprovalTimeout,
    fallback: '72h',
  })

  const spec: DepartmentSpec = {
    id: row.id,
    key: department,
    displayName: row.displayName || DEPARTMENTS[department].displayName,
    charter: row.charter,
    tools: parseStringArray(row.config?.tools, DEFAULT_TOOLS),
    memoryScopes: parseStringArray(row.config?.memoryScopes, ['company', department]),
    autoApprove: parseRiskTiers(row.config?.autoApprove),
    maxSteps: row.config?.maxSteps ?? 12,
    modelOverrides: overrides,
  }

  return new DepartmentAgent({
    prisma,
    router,
    spec,
    workspaceId,
    approvalTimeoutMs: parseDuration(timeout),
  })
}

/** '72h' | '30m' | '7d' → milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim())
  if (!match) return 72 * 60 * 60 * 1000

  const amount = Number(match[1])
  const unit = match[2]

  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit ?? 'h'] ?? 3_600_000

  return amount * multiplier
}
