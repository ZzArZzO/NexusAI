import { loadAgent } from '@nexusai/agents'
import { canDelegate, DelegationNotPermittedError } from '@nexusai/core'
import { prisma, workspaces } from '@nexusai/db'
import { NonRetriableError } from 'inngest'

import { inngest } from '../client'
import { DepartmentRun, RunFinished, TaskDelegated } from '../events'

/**
 * Running a department, durably.
 *
 * Every autonomous action in the company routes through here, which is why the
 * pause check and the budget check live at the top rather than inside each
 * department: they are properties of the company, not of any one agent. Checking
 * before the first step also means a stopped run leaves nothing half-done.
 */
export const runDepartment = inngest.createFunction(
  {
    id: 'department-run',
    name: 'Run a department',
    triggers: [DepartmentRun],
    /**
     * One run per department at a time. Two CEO runs writing goals concurrently
     * would interleave in ways neither expects, and the operator would have no
     * way to tell which produced what.
     */
    concurrency: [{ key: 'event.data.department', limit: 1 }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { workspaceId, department, objective, trigger, parentRunId, conversationId } = event.data

    // Its own step, so the reason appears in the run history rather than being an
    // unexplained early return.
    const gate = await step.run('check-preconditions', async () => {
      if (await workspaces.isAutomationPaused(prisma, workspaceId)) {
        return { proceed: false as const, reason: 'automation is paused' }
      }

      const budget = await remainingBudgetMicros(workspaceId)
      if (budget <= 0) {
        return { proceed: false as const, reason: 'the monthly model budget is exhausted' }
      }

      return { proceed: true as const, budgetMicros: budget }
    })

    if (!gate.proceed) {
      return { skipped: true, reason: gate.reason }
    }

    const result = await step.run('run-agent', async () => {
      const agent = await loadAgent({ prisma, workspaceId, department })

      return agent.run({
        objective,
        trigger,
        ...(parentRunId === undefined ? {} : { parentRunId }),
        ...(conversationId === undefined ? {} : { conversationId }),
      })
    })

    await step.sendEvent(
      'announce',
      RunFinished.create({
        workspaceId,
        runId: result.runId,
        department,
        status: 'succeeded',
        costMicros: result.costMicros,
      }),
    )

    return { runId: result.runId, costMicros: result.costMicros, text: result.text }
  },
)

/**
 * Delegation.
 *
 * The org chart is enforced here, not merely documented: a department that tries
 * to delegate outside its permitted edges fails loudly and is not retried, because
 * retrying a structurally impossible request just burns attempts.
 */
export const delegateTask = inngest.createFunction(
  { id: 'task-delegate', name: 'Delegate a task', triggers: [TaskDelegated], retries: 2 },
  async ({ event, step }) => {
    const { workspaceId, from, to, objective, parentRunId } = event.data

    if (!canDelegate(from, to)) {
      throw new NonRetriableError(new DelegationNotPermittedError(from, to).message)
    }

    return step.invoke('run-target-department', {
      function: runDepartment,
      data: {
        workspaceId,
        department: to,
        objective,
        trigger: 'delegation' as const,
        ...(parentRunId === undefined ? {} : { parentRunId }),
      },
    })
  },
)

/**
 * Remaining model spend for the calendar month, in micro-dollars.
 *
 * A budget that is checked but never enforced is a number on a dashboard. This is
 * the enforcement point, and it is at the head of a run deliberately: stopping
 * halfway leaves side effects with nobody to finish them.
 */
export async function remainingBudgetMicros(workspaceId: string): Promise<number> {
  const ceiling = await workspaces.getSetting<number>(prisma, {
    workspaceId,
    key: 'automation.monthly_budget_micros',
    fallback: 100_000_000,
  })

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const spent = await prisma.run.aggregate({
    where: { workspaceId, startedAt: { gte: monthStart } },
    _sum: { costMicros: true },
  })

  return Math.max(0, ceiling - (spent._sum.costMicros ?? 0))
}
