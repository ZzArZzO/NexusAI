import { departmentActor, type DepartmentId, type RiskTier } from '@nexusai/core'
import { audit, runs as runRepo, workspaces, type PrismaClient } from '@nexusai/db'
import type { ConnectorRegistry } from '@nexusai/integrations'
import {
  generateText,
  isStepCount,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai'

import { recall, renderForPrompt } from '../memory/index'
import { costMicros } from '../models/pricing'
import type { ModelRole, ModelRouter } from '../models/router'
import { toTokenUsage } from '../models/usage'
import { createRegistry, DEFAULT_TOOLS } from '../tools/builtin'
import { createConnectorTools } from '../tools/connectors'
import type { ToolContext } from '../tools/registry'

/**
 * The kernel.
 *
 * One class, nine configurations. A department differs only in its charter, its
 * tool allowlist, its model roles and its memory scopes — so a bug fixed here is
 * fixed for the whole company, and a department cannot quietly acquire
 * behaviour the others do not have.
 *
 * Two execution modes share everything below: `run()` for autonomous work and
 * `stream()` for interactive chat. They are the same agent, which is what makes
 * "what the CEO does at 6am" and "what the CEO does when you ask it" the same
 * thing rather than two implementations that drift.
 */

export interface DepartmentSpec {
  id: string
  key: DepartmentId
  displayName: string
  charter: string
  tools: readonly string[]
  memoryScopes: readonly string[]
  autoApprove: readonly RiskTier[]
  maxSteps: number
  modelOverrides?: Partial<Record<ModelRole, string>> | undefined
}

export interface AgentOptions {
  prisma: PrismaClient
  router: ModelRouter
  spec: DepartmentSpec
  workspaceId: string
  /** Wall-clock a gated action waits before expiring as not-done. */
  approvalTimeoutMs?: number
  /**
   * Connector registry. Omitted means no integration tools at all — which is the
   * correct default for a test, and the honest state of a workspace that has
   * connected nothing.
   */
  connectors?: ConnectorRegistry | undefined
  /**
   * Ask connected MCP servers for their tool lists. A network round trip per
   * server, so it is off for chat and on for autonomous runs, where a few hundred
   * milliseconds does not matter and completeness does.
   */
  discoverRemoteTools?: boolean | undefined
}

export class AutomationPausedError extends Error {
  constructor() {
    super(
      'Automation is paused for this workspace. No autonomous run will start until it is resumed.',
    )
    this.name = 'AutomationPausedError'
  }
}

const HOUR_MS = 60 * 60 * 1000

/**
 * What `stream()` hands back.
 *
 * Named via `ReturnType` because `streamText` is generic over the tool set, and
 * the tool set here is assembled at runtime from a department's allowlist — so
 * the concrete type is not writable by hand, and without this alias TypeScript
 * refuses to emit a declaration for a public method that returns it.
 */
type StreamResult = ReturnType<typeof streamText>

export class DepartmentAgent {
  constructor(private readonly options: AgentOptions) {}

  get key(): DepartmentId {
    return this.options.spec.key
  }

  /**
   * System prompt: the charter, plus the facts the agent needs to behave.
   *
   * Memory is injected as retrieved context rather than left for the model to
   * ask for, when there is a clear query — a first turn that spends a tool call
   * discovering it should have searched is a wasted round trip.
   */
  private systemPrompt(memoryContext: string | null): string {
    const { spec } = this.options

    const parts = [
      spec.charter,
      '',
      '## Your situation',
      `You are the ${spec.displayName} department of a company run by one person.`,
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      this.options.router.live
        ? ''
        : 'NOTE: you are running on a mock model with no API key configured. Say so if asked why your answers seem thin.',
    ]

    if (memoryContext) {
      parts.push(
        '',
        '## Retrieved from long-term memory',
        'Cite these by their bracketed number when you use them. If they do not answer the question, say so and search again with a different query rather than guessing.',
        '',
        memoryContext,
      )
    }

    return parts.filter((part) => part !== '').join('\n')
  }

  private toolContext(runId: string): ToolContext {
    return {
      prisma: this.options.prisma,
      actor: departmentActor({
        id: this.options.spec.id,
        key: this.options.spec.key,
        workspaceId: this.options.workspaceId,
      }),
      workspaceId: this.options.workspaceId,
      runId,
      autoApprove: this.options.spec.autoApprove,
      approvalTimeoutMs: this.options.approvalTimeoutMs ?? 72 * HOUR_MS,
    }
  }

  /**
   * Assemble the tool set for one run.
   *
   * Native tools come from the department's allowlist. Connector tools are added by
   * *capability* instead, because their names depend on what the operator has
   * connected — and an MCP server's names are not knowable until it answers. Both
   * kinds go through the same `defineTool` wrapper, so both hit the same gate.
   */
  private async buildTools(runId: string, discover: boolean) {
    const registry = createRegistry({
      router: this.options.router,
      scopes: [...this.options.spec.memoryScopes],
    })

    const allowlist = this.options.spec.tools.length > 0 ? this.options.spec.tools : DEFAULT_TOOLS
    const context = this.toolContext(runId)

    if (!this.options.connectors) {
      return registry.toolsFor(allowlist, context)
    }

    const connector = await createConnectorTools({
      prisma: this.options.prisma,
      registry: this.options.connectors,
      workspaceId: this.options.workspaceId,
      department: this.options.spec.key,
      discover,
    })

    registry.register(...connector.tools)

    return registry.toolsFor([...allowlist, ...connector.names], context)
  }

  /** Pre-fetch memory when the request obviously needs context. */
  private async prefetchMemory(query: string): Promise<{ context: string | null; ids: string[] }> {
    if (query.trim().length < 8) return { context: null, ids: [] }

    const chunks = await recall({
      prisma: this.options.prisma,
      router: this.options.router,
      workspaceId: this.options.workspaceId,
      query,
      scopes: [...this.options.spec.memoryScopes],
      limit: 5,
    })

    if (chunks.length === 0) return { context: null, ids: [] }

    return { context: renderForPrompt(chunks), ids: chunks.map((chunk) => chunk.id) }
  }

  /**
   * Autonomous execution.
   *
   * Refuses to start when automation is paused. That check is here, at the head
   * of the run, rather than inside each tool — pausing the company should stop
   * the work beginning, not stop it halfway with side effects already written.
   */
  async run(params: {
    objective: string
    trigger: 'schedule' | 'event' | 'delegation' | 'manual'
    parentRunId?: string
    conversationId?: string
  }): Promise<{ runId: string; text: string; costMicros: number }> {
    const { prisma, router, spec, workspaceId } = this.options

    if (await workspaces.isAutomationPaused(prisma, workspaceId)) {
      throw new AutomationPausedError()
    }

    const { model, modelId } = router.language('reasoning')
    const memory = await this.prefetchMemory(params.objective)

    const run = await runRepo.startRun(prisma, {
      workspaceId,
      departmentId: spec.id,
      trigger: params.trigger,
      objective: params.objective,
      ...(params.parentRunId === undefined ? {} : { parentRunId: params.parentRunId }),
      ...(params.conversationId === undefined ? {} : { conversationId: params.conversationId }),
    })

    try {
      const result = await generateText({
        model,
        system: this.systemPrompt(memory.context),
        prompt: params.objective,
        tools: await this.buildTools(run.id, this.options.discoverRemoteTools ?? true),
        stopWhen: isStepCount(spec.maxSteps),
        onStepFinish: async (step) => {
          await this.recordStep(run.id, step, memory.ids, modelId)
        },
      })

      const usage = toTokenUsage(result.usage)
      const cost = costMicros(modelId, usage)

      await runRepo.finishRun(prisma, {
        runId: run.id,
        status: 'succeeded',
        outcome: result.text,
        usage: { ...usage, costMicros: cost },
      })

      await audit.record(prisma, {
        workspaceId,
        actor: { departmentId: spec.id },
        action: 'completed',
        resource: 'run',
        resourceId: run.id,
        metadata: { trigger: params.trigger, costMicros: cost },
      })

      return { runId: run.id, text: result.text, costMicros: cost }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await runRepo.finishRun(prisma, { runId: run.id, status: 'failed', error: message })
      throw error
    }
  }

  /**
   * Interactive execution.
   *
   * Returns the AI SDK stream directly so the route handler can pipe it to the
   * client, while `onFinish` closes out the run record. The run is opened before
   * streaming starts, so a client that disconnects mid-answer still leaves a
   * durable record of what was attempted.
   */
  async stream(params: {
    messages: ModelMessage[]
    conversationId?: string
    userQuery: string
  }): Promise<{ runId: string; result: StreamResult }> {
    const { prisma, router, spec, workspaceId } = this.options

    const { model, modelId } = router.language('drafting')
    const memory = await this.prefetchMemory(params.userQuery)

    const run = await runRepo.startRun(prisma, {
      workspaceId,
      departmentId: spec.id,
      trigger: 'chat',
      objective: params.userQuery.slice(0, 500),
      ...(params.conversationId === undefined ? {} : { conversationId: params.conversationId }),
    })

    const result = streamText({
      model,
      system: this.systemPrompt(memory.context),
      messages: params.messages,
      tools: await this.buildTools(run.id, false),
      stopWhen: isStepCount(spec.maxSteps),

      onStepFinish: async (step) => {
        await this.recordStep(run.id, step, memory.ids, modelId)
      },

      onFinish: async (event) => {
        const usage = toTokenUsage(event.usage)

        await runRepo.finishRun(prisma, {
          runId: run.id,
          status: 'succeeded',
          outcome: event.text,
          usage: { ...usage, costMicros: costMicros(modelId, usage) },
        })
      },

      onError: async ({ error }) => {
        await runRepo.finishRun(prisma, {
          runId: run.id,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      },
    })

    // The cast reconciles the concrete instantiation with the alias. `streamText`
    // is generic over its tool set, and this one is assembled at runtime from a
    // department's allowlist, so the two spellings of the same type do not unify
    // structurally. Nothing is being widened — see the StreamResult note above.
    return { runId: run.id, result: result as StreamResult }
  }

  /**
   * Record one loop iteration.
   *
   * `citedChunkIds` is stored on the step rather than derived later, because the
   * chunk it cited may be re-ingested or deleted afterwards — and "which text
   * did it actually read" must survive that.
   */
  private async recordStep(
    runId: string,
    step: RecordableStep,
    citedChunkIds: string[],
    modelId: string,
  ): Promise<void> {
    const existing = await this.options.prisma.runStep.count({ where: { runId } })
    const usage = toTokenUsage(step.usage)

    await runRepo.recordStep(this.options.prisma, {
      runId,
      index: existing,
      model: modelId,
      citedChunkIds,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      summary: summariseStep(step),
    })
  }
}

/**
 * The shape of a step, structurally.
 *
 * The SDK's own `StepResult` is generic over the tool set, and the tool set here
 * is built at runtime from a department's allowlist — so naming the concrete
 * type would mean threading generics through the whole kernel for no benefit.
 * This is everything the instrumentation reads.
 */
interface RecordableStep {
  usage: LanguageModelUsage
  text: string
  toolCalls?: readonly { toolName: string }[] | undefined
}

/** A caption for the run timeline — what this step did, in one line. */
function summariseStep(step: RecordableStep): string {
  const calls = step.toolCalls ?? []

  if (calls.length > 0) {
    return `Called ${calls.map((call) => call.toolName).join(', ')}`
  }

  const text = step.text.trim()
  if (text === '') return 'No output'

  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}
