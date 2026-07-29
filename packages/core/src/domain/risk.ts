import { z } from 'zod'

/**
 * The safety spine of the whole system.
 *
 * Every tool declares a risk tier. The tier — not the agent, not the prompt —
 * decides whether an action executes immediately or pauses for human approval.
 * An agent cannot talk its way past this because the check happens in the
 * executor, outside the model's reach.
 */
export const RISK_TIERS = ['read', 'internal', 'external', 'financial'] as const

export const riskTierSchema = z.enum(RISK_TIERS)
export type RiskTier = z.infer<typeof riskTierSchema>

interface RiskPolicy {
  readonly tier: RiskTier
  readonly description: string
  /** Whether execution must pause on an approval gate before the tool runs. */
  readonly requiresApproval: boolean
  /** Whether approving also requires an explicit second confirmation step. */
  readonly requiresSecondConfirmation: boolean
}

export const RISK_POLICY: Readonly<Record<RiskTier, RiskPolicy>> = Object.freeze({
  read: {
    tier: 'read',
    description: 'Fetches, searches or analyses. Changes no state anywhere.',
    requiresApproval: false,
    requiresSecondConfirmation: false,
  },
  internal: {
    tier: 'internal',
    description: "Writes only to NexusAI's own database. Never leaves the system.",
    requiresApproval: false,
    requiresSecondConfirmation: false,
  },
  external: {
    tier: 'external',
    description: 'Leaves the system: sends email, posts publicly, messages a person, pushes code.',
    requiresApproval: true,
    requiresSecondConfirmation: false,
  },
  financial: {
    tier: 'financial',
    description: 'Moves money or commits spend.',
    requiresApproval: true,
    requiresSecondConfirmation: true,
  },
})

export function requiresApproval(tier: RiskTier): boolean {
  return RISK_POLICY[tier].requiresApproval
}

export function requiresSecondConfirmation(tier: RiskTier): boolean {
  return RISK_POLICY[tier].requiresSecondConfirmation
}

/**
 * Ordering used when a workflow's overall risk is the maximum of its steps.
 * Higher index means more dangerous.
 */
export function riskRank(tier: RiskTier): number {
  return RISK_TIERS.indexOf(tier)
}

export function highestRisk(tiers: readonly RiskTier[]): RiskTier {
  return tiers.reduce<RiskTier>(
    (worst, tier) => (riskRank(tier) > riskRank(worst) ? tier : worst),
    'read',
  )
}
