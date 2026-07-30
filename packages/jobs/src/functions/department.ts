import { loadAgent } from '@nexusai/agents'
import { canDelegate, DelegationNotPermittedError, formatBudget } from '@nexusai/core'
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

      // `workspaces.budget` is the one implementation of "are we over budget",
      // shared with the kernel and the dashboard. This used to be a second local
      // copy with its own default and its own idea of when a month starts, which
      // is how a workflow and a UI end up disagreeing about whether work stopped.
      const budget = await workspaces.budget(prisma, { workspaceId })
      if (budget.blocksAutonomous) {
        return {
          proceed: false as const,
          reason: `the monthly model budget is exhausted (${formatBudget(budget.spentMicros)} of ${formatBudget(budget.limitMicros ?? 0)})`,
        }
      }

      return { proceed: true as const, remainingMicros: budget.remainingMicros }
    })

    if (!gate.proceed) {
      return { skipped: true, reason: gate.reason }
    }

    const result = await step.run('run-agent', async () => {
      // Autonomous runs discover remote MCP tools; a chat does not. See
      // LoadAgentParams.discoverRemoteTools.
      const agent = await loadAgent({ prisma, workspaceId, department, discoverRemoteTools: true })

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
 * Kept as a named export because it reads well at call sites and because the
 * scheduled functions want the number rather than the whole status. It delegates
 * to `workspaces.budget` — there is one implementation of this question, and this
 * is a view onto it, not a second answer.
 *
 * `Infinity` when no limit is set, so `remaining > 0` is a correct test in every
 * case rather than only when a limit happens to exist.
 */
export async function remainingBudgetMicros(workspaceId: string): Promise<number> {
  const status = await workspaces.budget(prisma, { workspaceId })
  return status.remainingMicros ?? Number.POSITIVE_INFINITY
}
