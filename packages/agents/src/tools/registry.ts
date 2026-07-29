import {
  ApprovalRequiredError,
  assert,
  requiresApproval,
  requiresSecondConfirmation,
  type DepartmentActor,
  type RiskTier,
} from '@nexusai/core'
import { approvals, audit, runs as runRepo, type PrismaClient } from '@nexusai/db'
import { tool as aiTool, type Tool } from 'ai'
import type { z } from 'zod'

/**
 * The tool registry — and the risk gate.
 *
 * The single most important property of this file: **the gate wraps `execute`**.
 * It is not a check the kernel performs before calling a tool, because then a
 * second call site, a retry path, or a future refactor could reach the tool
 * without it. Wrapping the function means there is no way to invoke the tool
 * that does not pass through the gate.
 *
 * Beneath it there is a third lock — the `tool_call_approval_gate` trigger in
 * Postgres, which refuses to record a high-risk call as succeeded without an
 * approved request. Three independent layers, because the cost of getting this
 * wrong is an email the operator never agreed to send.
 */

export interface ToolContext {
  prisma: PrismaClient
  actor: DepartmentActor
  workspaceId: string
  runId: string
  /** Set when the executor is inside a step, so tool calls attach to it. */
  runStepId?: string | undefined
  /** Risk tiers this department may run without a gate. Never includes 'financial'. */
  autoApprove: readonly RiskTier[]
  /** How long an approval waits before expiring as not-done. */
  approvalTimeoutMs: number
  /**
   * Inngest event the workflow is parked on. Present only for autonomous runs;
   * an interactive chat has nothing to resume, so a gated tool simply reports
   * that it is waiting.
   */
  resumeEvent?: string | undefined
}

export interface ToolDefinition<TInput extends z.ZodType = z.ZodType> {
  name: string
  description: string
  risk: RiskTier
  inputSchema: TInput
  /** Permission the acting department must hold, beyond the risk gate. */
  permission?: string
  /**
   * Human-readable summary of what approving this would do. Written for the
   * operator, in their terms — this is what they read at 7am deciding whether to
   * let it happen.
   */
  describe?: (input: z.infer<TInput>) => { title: string; summary: string }
  execute: (input: z.infer<TInput>, context: ToolContext) => Promise<unknown>
}

export interface NexusTool<TInput extends z.ZodType = z.ZodType> extends ToolDefinition<TInput> {
  /** Build the AI SDK tool, with the gate and instrumentation wrapped around execute. */
  build: (context: ToolContext) => Tool
}

/** Returned to the model when an action is parked. Deliberately explicit. */
export interface AwaitingApproval {
  status: 'awaiting_approval'
  approvalId: string
  message: string
}

export function defineTool<TInput extends z.ZodType>(
  definition: ToolDefinition<TInput>,
): NexusTool<TInput> {
  return {
    ...definition,

    build(context: ToolContext): Tool {
      return aiTool({
        description: definition.description,
        inputSchema: definition.inputSchema,

        execute: async (rawInput: unknown) => {
          const startedAt = Date.now()
          const input = definition.inputSchema.parse(rawInput)

          // 1. Permission. An agent cannot do what its department may not do,
          //    regardless of what the model decided to call.
          if (definition.permission) {
            assert(context.actor, definition.permission, { workspaceId: context.workspaceId })
          }

          // 2. The gate.
          const gated =
            requiresApproval(definition.risk) && !context.autoApprove.includes(definition.risk)

          if (gated) {
            return parkForApproval(definition, input, context)
          }

          // 3. Execute, recording the outcome either way.
          try {
            const output = await definition.execute(input, context)

            await runRepo.recordToolCall(context.prisma, {
              runId: context.runId,
              toolName: definition.name,
              risk: definition.risk,
              status: 'succeeded',
              input,
              output,
              durationMs: Date.now() - startedAt,
              ...(context.runStepId === undefined ? {} : { runStepId: context.runStepId }),
            })

            if (definition.risk !== 'read') {
              await audit.record(context.prisma, {
                workspaceId: context.workspaceId,
                actor: { departmentId: context.actor.id },
                action: 'executed',
                resource: `tool:${definition.name}`,
                metadata: { runId: context.runId, risk: definition.risk },
              })
            }

            return output
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            await runRepo.recordToolCall(context.prisma, {
              runId: context.runId,
              toolName: definition.name,
              risk: definition.risk,
              status: 'failed',
              input,
              error: message,
              durationMs: Date.now() - startedAt,
              ...(context.runStepId === undefined ? {} : { runStepId: context.runStepId }),
            })

            // Returned rather than rethrown: the model should learn the tool
            // failed and adapt, not have the whole run collapse. The failure is
            // already recorded, so nothing is hidden by continuing.
            return { status: 'failed' as const, error: message }
          }
        },
      })
    },
  }
}

/**
 * Record the intent, create the approval, and return without executing.
 *
 * The tool_call row is written as `awaiting_approval` first, so that even if the
 * process dies here there is a durable record that something was *attempted* —
 * an attempted external action that leaves no trace is precisely what an audit
 * trail exists to prevent.
 */
async function parkForApproval<TInput extends z.ZodType>(
  definition: ToolDefinition<TInput>,
  input: z.infer<TInput>,
  context: ToolContext,
): Promise<AwaitingApproval> {
  const described = definition.describe?.(input) ?? {
    title: `${definition.name} requested`,
    summary: `${context.actor.key} wants to run ${definition.name}.`,
  }

  const toolCall = await runRepo.recordToolCall(context.prisma, {
    runId: context.runId,
    toolName: definition.name,
    risk: definition.risk,
    status: 'awaiting_approval',
    input,
    ...(context.runStepId === undefined ? {} : { runStepId: context.runStepId }),
  })

  const approval = await approvals.createApproval(context.prisma, {
    workspaceId: context.workspaceId,
    departmentId: context.actor.id,
    runId: context.runId,
    toolCallId: toolCall.id,
    risk: definition.risk,
    title: described.title,
    summary: described.summary,
    payload: input,
    requiresSecondConfirmation: requiresSecondConfirmation(definition.risk),
    expiresAt: new Date(Date.now() + context.approvalTimeoutMs),
    ...(context.resumeEvent === undefined ? {} : { resumeEvent: context.resumeEvent }),
  })

  await audit.record(context.prisma, {
    workspaceId: context.workspaceId,
    actor: { departmentId: context.actor.id },
    action: 'requested_approval',
    resource: `tool:${definition.name}`,
    resourceId: approval.id,
    metadata: { runId: context.runId, risk: definition.risk },
  })

  return {
    status: 'awaiting_approval',
    approvalId: approval.id,
    message:
      `This action needs the operator's approval and has NOT happened. ` +
      `Do not describe it as done. Tell them it is waiting, and stop.`,
  }
}

/**
 * The registry.
 *
 * A department receives only the tools it is granted. A tool it was not granted
 * is not merely refused at call time — it is never described to the model, so it
 * cannot be attempted or hallucinated as available.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, NexusTool>()

  register(...tools: NexusTool<z.ZodType>[]): this {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered.`)
      }
      this.tools.set(tool.name, tool)
    }
    return this
  }

  get(name: string): NexusTool | undefined {
    return this.tools.get(name)
  }

  names(): string[] {
    return [...this.tools.keys()].sort()
  }

  /** Every tool at or above a risk tier — used by tests and the settings UI. */
  byRisk(risk: RiskTier): NexusTool[] {
    return [...this.tools.values()].filter((tool) => tool.risk === risk)
  }

  /** Build the AI SDK tool set for one department's allowlist. */
  toolsFor(allowlist: readonly string[], context: ToolContext): Record<string, Tool> {
    const result: Record<string, Tool> = {}

    for (const name of allowlist) {
      const tool = this.tools.get(name)
      if (!tool) {
        throw new Error(
          `Department "${context.actor.key}" is granted unknown tool "${name}". ` +
            `Known tools: ${this.names().join(', ')}`,
        )
      }
      result[name] = tool.build(context)
    }

    return result
  }
}

export { ApprovalRequiredError }
