'use server'

import { assert } from '@nexusai/core'
import { audit, prisma, SETTING, workspaces } from '@nexusai/db'
import { revalidatePath } from 'next/cache'

import { requireActor } from '@/lib/session'

/**
 * The global pause.
 *
 * Every autonomous workflow reads this before its first step, so flipping it is
 * the fastest way to stop the company doing anything at all. It is a `setting:update`,
 * which the operator role deliberately does not hold — stopping the machine and
 * running the machine are different authorities.
 */
export async function toggleAutomationPause(): Promise<{ paused: boolean }> {
  const { actor, workspace } = await requireActor()

  assert(actor, 'setting:update', { workspaceId: workspace.id })

  const current = await workspaces.isAutomationPaused(prisma, workspace.id)
  const next = !current

  await workspaces.setSetting(prisma, {
    workspaceId: workspace.id,
    key: SETTING.automationPaused,
    value: next,
  })

  await audit.record(prisma, {
    workspaceId: workspace.id,
    actor: { userId: actor.id },
    action: next ? 'paused' : 'resumed',
    resource: 'automation',
    before: { paused: current },
    after: { paused: next },
  })

  revalidatePath('/', 'layout')

  return { paused: next }
}

/**
 * The monthly model spend limit.
 *
 * Stored in micro-dollars, entered in dollars, because the operator thinks in
 * dollars and the ledger cannot afford a float.
 *
 * An empty value clears the limit. That is a real thing to want — "I will watch it
 * myself" — and is distinct from setting it to zero, which stops autonomous work
 * entirely. Both are allowed; conflating them is what would be wrong.
 */
export async function setMonthlyBudget(dollars: string): Promise<{ ok: boolean; message: string }> {
  const { actor, workspace } = await requireActor()

  assert(actor, 'setting:update', { workspaceId: workspace.id })

  const trimmed = dollars.trim()
  const value = trimmed === '' ? null : Number(trimmed)

  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    return { ok: false, message: 'Enter an amount in dollars, or leave it empty for no limit.' }
  }

  const before = await workspaces.budget(prisma, { workspaceId: workspace.id })

  await workspaces.setSetting(prisma, {
    workspaceId: workspace.id,
    key: SETTING.monthlyBudgetMicros,
    value: value === null ? null : Math.round(value * 1_000_000),
    description: 'Monthly model spend ceiling in micro-dollars. Null means no limit.',
  })

  await audit.record(prisma, {
    workspaceId: workspace.id,
    actor: { userId: actor.id },
    action: 'updated',
    resource: 'setting',
    resourceId: SETTING.monthlyBudgetMicros,
    before: { limitMicros: before.limitMicros },
    after: { limitMicros: value === null ? null : Math.round(value * 1_000_000) },
  })

  revalidatePath('/', 'layout')

  const after = await workspaces.budget(prisma, { workspaceId: workspace.id })

  return {
    ok: true,
    message:
      value === null
        ? 'Limit removed. Nothing will stop autonomous work on cost.'
        : after.blocksAutonomous
          ? // Said plainly rather than left to be discovered when nothing runs
            // tomorrow morning.
            `Set. This month's spend already exceeds it, so scheduled work is stopped.`
          : 'Set.',
  }
}
