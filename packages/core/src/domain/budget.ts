/**
 * Spend limits.
 *
 * The whole reason this exists: an agent company that plans its own work can
 * spend money at a rate nobody chose. A scheduled brief that quietly starts
 * costing five times what it did last month is not a bug that announces itself —
 * it announces itself on a card statement, weeks later.
 *
 * Amounts are integer **micro-dollars** throughout, the same unit `run.cost_micros`
 * uses, so nothing here needs a float and nothing can drift by a rounding error.
 *
 * The interesting decision is *asymmetry*, and it is deliberate:
 *
 *  - **Autonomous runs stop at the limit.** Work the operator did not ask for
 *    should not be the thing that spends the last of the budget.
 *  - **Interactive chat does not.** Locking the operator out of their own tool
 *    because a cron job overspent punishes the wrong person, and the operator is
 *    the one who can actually decide what to do about it. They are told instead.
 *
 * That means the limit is a brake on automation, not a hard cap on the account —
 * which is stated here rather than left for someone to discover.
 */

export const MICROS_PER_DOLLAR = 1_000_000

/** Fraction of the limit at which the operator is warned rather than blocked. */
export const BUDGET_WARN_AT = 0.8

export type BudgetState = 'ok' | 'warning' | 'exceeded' | 'unlimited'

export interface BudgetStatus {
  state: BudgetState
  spentMicros: number
  /** Null when no limit is configured. */
  limitMicros: number | null
  /** 0–1 against the limit; null when unlimited. */
  fraction: number | null
  remainingMicros: number | null
  /** True when a new autonomous run must be refused. */
  blocksAutonomous: boolean
}

export function budgetStatus(spentMicros: number, limitMicros: number | null): BudgetStatus {
  // A limit of zero means "no autonomous spending at all", which is a legitimate
  // thing to want and must not be confused with "unset". Only null is unset.
  if (limitMicros === null) {
    return {
      state: 'unlimited',
      spentMicros,
      limitMicros: null,
      fraction: null,
      remainingMicros: null,
      blocksAutonomous: false,
    }
  }

  const fraction = limitMicros === 0 ? 1 : spentMicros / limitMicros
  const exceeded = spentMicros >= limitMicros

  return {
    state: exceeded ? 'exceeded' : fraction >= BUDGET_WARN_AT ? 'warning' : 'ok',
    spentMicros,
    limitMicros,
    fraction,
    remainingMicros: Math.max(0, limitMicros - spentMicros),
    blocksAutonomous: exceeded,
  }
}

/**
 * The window a limit applies to: this calendar month in the workspace's own
 * reckoning, from a UTC instant.
 *
 * Calendar month rather than a rolling 30 days, because the bill the operator is
 * comparing against arrives monthly — a rolling window would produce a number
 * that never matches any invoice.
 */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** `$4.20`, from micro-dollars. Two decimals, because this is money. */
export function formatBudget(micros: number): string {
  return `$${(micros / MICROS_PER_DOLLAR).toFixed(2)}`
}

/**
 * What to tell an agent that is over budget.
 *
 * Written for the model, in the second person, and explicit that the constraint
 * is external — otherwise a model told only "budget exceeded" will apologise and
 * try again with a shorter prompt, which spends more money.
 */
export function budgetRefusalMessage(status: BudgetStatus): string {
  return (
    `This workspace has spent ${formatBudget(status.spentMicros)} of its ` +
    `${formatBudget(status.limitMicros ?? 0)} monthly model budget. ` +
    `Autonomous runs are stopped until the operator raises the limit or the month rolls over. ` +
    `Do not retry and do not attempt a cheaper version of the work — the limit is not about this task.`
  )
}
