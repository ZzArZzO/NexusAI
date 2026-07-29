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
