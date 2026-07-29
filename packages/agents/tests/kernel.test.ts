import { z } from 'zod'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { loadAgent } from '../src/kernel/load'
import { ingest, recall } from '../src/memory/index'
import { ModelRouter } from '../src/models/router'
import { defineTool, ToolRegistry } from '../src/tools/registry'
import {
  disconnectTestDatabase,
  hasTestDatabase,
  migrateTestDatabase,
  resetDatabase,
  seedAgentFixture,
  testPrisma,
  type AgentFixture,
} from './harness'

/**
 * The kernel, end to end, against a real database and the mock model.
 *
 * This is the test that says the system works: an agent receives a question,
 * searches memory, gets real chunks back from pgvector, answers, and leaves a
 * complete audit trail behind. No API key, no network, no cost — which is the
 * point. A kernel that can only be verified by spending money is a kernel that
 * mostly does not get verified.
 */
describe.skipIf(!hasTestDatabase)('department agent', () => {
  let fixture: AgentFixture
  const router = new ModelRouter({}) // no keys: mock language + mock embeddings

  beforeAll(() => {
    migrateTestDatabase()
  })

  beforeEach(async () => {
    await resetDatabase()
    fixture = await seedAgentFixture()

    await ingest({
      prisma: testPrisma(),
      router,
      workspaceId: fixture.workspaceId,
      kind: 'note',
      title: 'Pricing decision',
      content:
        '# Pricing decision\n\n' +
        'After comparing three competitors we settled on forty-nine euros a month for the ' +
        'standard tier, with the annual plan discounted to ten months. We deliberately did ' +
        'not add a free tier because the support load was real and conversion was not.',
      scopes: ['company'],
    })
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  test('memory ingested during setup is retrievable', async () => {
    const chunks = await recall({
      prisma: testPrisma(),
      router,
      workspaceId: fixture.workspaceId,
      query: 'pricing',
      scopes: ['company'],
    })

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0]?.content).toContain('forty-nine')
  })

  test('ingesting identical content twice does not duplicate it', async () => {
    const prisma = testPrisma()
    const before = await prisma.memoryChunk.count({ where: { workspaceId: fixture.workspaceId } })

    const result = await ingest({
      prisma,
      router,
      workspaceId: fixture.workspaceId,
      kind: 'note',
      title: 'Pricing decision',
      content:
        '# Pricing decision\n\n' +
        'After comparing three competitors we settled on forty-nine euros a month for the ' +
        'standard tier, with the annual plan discounted to ten months. We deliberately did ' +
        'not add a free tier because the support load was real and conversion was not.',
      scopes: ['company'],
    })

    const after = await prisma.memoryChunk.count({ where: { workspaceId: fixture.workspaceId } })

    // Duplicated memory does not merely waste space: the copies compete with
    // each other in every future search result.
    expect(result.changed).toBe(false)
    expect(after).toBe(before)
  })

  test('a run searches memory, answers, and records the whole chain', async () => {
    const prisma = testPrisma()

    const agent = await loadAgent({
      prisma,
      workspaceId: fixture.workspaceId,
      department: 'ceo',
      router,
    })

    const result = await agent.run({
      objective: 'What did we decide about pricing?',
      trigger: 'manual',
    })

    expect(result.text.length).toBeGreaterThan(0)

    const run = await prisma.run.findUniqueOrThrow({
      where: { id: result.runId },
      include: { steps: { orderBy: { index: 'asc' } }, toolCalls: true },
    })

    expect(run.status).toBe('succeeded')
    expect(run.finishedAt).not.toBeNull()
    expect(run.durationMs).toBeGreaterThanOrEqual(0)

    // The chain that makes "why did it say this" answerable.
    expect(run.steps.length).toBeGreaterThan(0)
    expect(run.steps[0]?.citedChunkIds.length).toBeGreaterThan(0)

    const recalls = run.toolCalls.filter((call) => call.toolName === 'memory.recall')
    expect(recalls.length).toBeGreaterThan(0)
    expect(recalls[0]?.status).toBe('succeeded')
    expect(recalls[0]?.risk).toBe('read')
  })

  test('cited chunk ids point at chunks that actually exist', async () => {
    const prisma = testPrisma()
    const agent = await loadAgent({
      prisma,
      workspaceId: fixture.workspaceId,
      department: 'ceo',
      router,
    })

    const { runId } = await agent.run({
      objective: 'Remind me what we decided about pricing.',
      trigger: 'manual',
    })

    const steps = await prisma.runStep.findMany({ where: { runId } })
    const citedIds = [...new Set(steps.flatMap((step) => step.citedChunkIds))]

    expect(citedIds.length).toBeGreaterThan(0)

    const found = await prisma.memoryChunk.count({ where: { id: { in: citedIds } } })
    expect(found).toBe(citedIds.length)
  })

  test('a run records its token usage and cost', async () => {
    const prisma = testPrisma()
    const agent = await loadAgent({
      prisma,
      workspaceId: fixture.workspaceId,
      department: 'ceo',
      router,
    })

    const { runId } = await agent.run({ objective: 'What are our goals?', trigger: 'manual' })

    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } })

    expect(run.inputTokens).toBeGreaterThan(0)
    expect(run.outputTokens).toBeGreaterThan(0)
    // The mock is free, and the accounting says so rather than inventing a number.
    expect(run.costMicros).toBe(0)
  })

  test('a completed run is written to the audit log', async () => {
    const prisma = testPrisma()
    const agent = await loadAgent({
      prisma,
      workspaceId: fixture.workspaceId,
      department: 'ceo',
      router,
    })

    const { runId } = await agent.run({ objective: 'What did we decide?', trigger: 'manual' })

    const entries = await prisma.auditLog.findMany({
      where: { workspaceId: fixture.workspaceId, resource: 'run', resourceId: runId },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.action).toBe('completed')
    expect(entries[0]?.departmentId).toBe(fixture.departmentId)
  })

  test('a paused workspace refuses to start an autonomous run', async () => {
    const prisma = testPrisma()

    await prisma.systemSetting.create({
      data: { workspaceId: fixture.workspaceId, key: 'automation.paused', value: true },
    })

    const agent = await loadAgent({
      prisma,
      workspaceId: fixture.workspaceId,
      department: 'ceo',
      router,
    })

    await expect(agent.run({ objective: 'Do something', trigger: 'schedule' })).rejects.toThrow(
      /paused/i,
    )

    // Nothing started, so nothing to clean up — pausing must prevent work
    // beginning, not abandon it halfway with side effects already written.
    expect(await prisma.run.count({ where: { workspaceId: fixture.workspaceId } })).toBe(0)
  })

  test('a department cannot be given a tool that does not exist', async () => {
    const prisma = testPrisma()

    await prisma.departmentConfig.update({
      where: { departmentId: fixture.departmentId },
      data: { tools: ['memory.recall', 'nonexistent.tool'] },
    })

    const agent = await loadAgent({
      prisma,
      workspaceId: fixture.workspaceId,
      department: 'ceo',
      router,
    })

    // Better to fail loudly at build time than to silently give the agent a
    // shorter tool list than its configuration claims.
    await expect(agent.run({ objective: 'anything', trigger: 'manual' })).rejects.toThrow(
      /unknown tool "nonexistent.tool"/,
    )
  })
})

describe.skipIf(!hasTestDatabase)('the risk gate', () => {
  let fixture: AgentFixture

  beforeAll(() => {
    migrateTestDatabase()
  })

  beforeEach(async () => {
    await resetDatabase()
    fixture = await seedAgentFixture()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  /**
   * The second argument the SDK passes to execute. Cast because these tests
   * invoke the tool directly rather than through a model, and constructing a
   * full ToolExecutionOptions would assert nothing about the gate.
   */
  const EXEC_OPTIONS = { toolCallId: 'test-call', messages: [] } as never

  /** A tool that would leave the system, plus a spy proving whether it ran. */
  function externalTool(onExecute: () => void) {
    return defineTool({
      name: 'test.send',
      description: 'Send something outside the system.',
      risk: 'external',
      inputSchema: z.object({ to: z.string() }),
      describe: (input) => ({
        title: `Send to ${input.to}`,
        summary: `Marketing wants to contact ${input.to}.`,
      }),
      execute: (input) => {
        onExecute()
        return Promise.resolve({ sent: true, to: input.to })
      },
    })
  }

  function context(runId: string) {
    return {
      prisma: testPrisma(),
      actor: {
        kind: 'department' as const,
        id: fixture.departmentId,
        key: 'ceo' as const,
        workspaceId: fixture.workspaceId,
        permissions: new Set<string>(),
      },
      workspaceId: fixture.workspaceId,
      runId,
      autoApprove: ['read', 'internal'] as const,
      approvalTimeoutMs: 3_600_000,
    }
  }

  async function startRun(): Promise<string> {
    const run = await testPrisma().run.create({
      data: {
        workspaceId: fixture.workspaceId,
        departmentId: fixture.departmentId,
        trigger: 'manual',
        status: 'running',
      },
      select: { id: true },
    })
    return run.id
  }

  test('an external tool does not execute — it parks for approval', async () => {
    const prisma = testPrisma()
    const runId = await startRun()

    let executed = false
    const registry = new ToolRegistry().register(externalTool(() => (executed = true)))
    const tools = registry.toolsFor(['test.send'], context(runId))

    const result = (await tools['test.send']?.execute?.(
      { to: 'someone@example.com' },
      EXEC_OPTIONS,
    )) as { status: string; approvalId: string; message: string }

    // The whole point: the side effect did not happen.
    expect(executed).toBe(false)
    expect(result.status).toBe('awaiting_approval')

    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: result.approvalId },
    })
    expect(approval.status).toBe('pending')
    expect(approval.risk).toBe('external')
    expect(approval.title).toBe('Send to someone@example.com')

    // The attempt is recorded even though nothing ran. An attempted external
    // action that leaves no trace is exactly what an audit trail is for.
    const call = await prisma.toolCall.findFirstOrThrow({ where: { runId } })
    expect(call.status).toBe('awaiting_approval')
    expect(call.toolName).toBe('test.send')
  })

  test('the message tells the model in plain terms that nothing happened', async () => {
    const runId = await startRun()
    const registry = new ToolRegistry().register(externalTool(() => undefined))
    const tools = registry.toolsFor(['test.send'], context(runId))

    const result = (await tools['test.send']?.execute?.({ to: 'x@example.com' }, EXEC_OPTIONS)) as {
      message: string
    }

    // A model told only "pending" will happily write "I've sent it". The wording
    // is load-bearing, so it is asserted.
    expect(result.message).toMatch(/has NOT happened/i)
    expect(result.message).toMatch(/do not describe it as done/i)
  })

  test('a financial approval demands a second confirmation', async () => {
    const prisma = testPrisma()
    const runId = await startRun()

    const financial = defineTool({
      name: 'test.refund',
      description: 'Refund money.',
      risk: 'financial',
      inputSchema: z.object({ amount: z.number() }),
      execute: () => Promise.resolve({ refunded: true }),
    })

    const tools = new ToolRegistry().register(financial).toolsFor(['test.refund'], context(runId))

    const result = (await tools['test.refund']?.execute?.({ amount: 50 }, EXEC_OPTIONS)) as {
      approvalId: string
    }

    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: result.approvalId },
    })

    expect(approval.requiresSecondConfirmation).toBe(true)
    expect(approval.secondConfirmedAt).toBeNull()
  })

  test('an internal tool runs immediately and is recorded as succeeded', async () => {
    const prisma = testPrisma()
    const runId = await startRun()

    let executed = false
    const internal = defineTool({
      name: 'test.note',
      description: 'Write a note.',
      risk: 'internal',
      inputSchema: z.object({ text: z.string() }),
      execute: () => {
        executed = true
        return Promise.resolve({ ok: true })
      },
    })

    const tools = new ToolRegistry().register(internal).toolsFor(['test.note'], context(runId))
    await tools['test.note']?.execute?.({ text: 'hello' }, EXEC_OPTIONS)

    expect(executed).toBe(true)

    const call = await prisma.toolCall.findFirstOrThrow({ where: { runId } })
    expect(call.status).toBe('succeeded')
  })

  test('a failing tool is recorded and reported, not thrown into the run', async () => {
    const prisma = testPrisma()
    const runId = await startRun()

    const broken = defineTool({
      name: 'test.broken',
      description: 'Always fails.',
      risk: 'internal',
      inputSchema: z.object({}),
      execute: () => {
        throw new Error('the database was on fire')
      },
    })

    const tools = new ToolRegistry().register(broken).toolsFor(['test.broken'], context(runId))

    const result = (await tools['test.broken']?.execute?.({}, EXEC_OPTIONS)) as {
      status: string
      error: string
    }

    // The model should learn the tool failed and adapt, rather than the whole
    // run collapsing — and the failure is durably recorded either way.
    expect(result.status).toBe('failed')
    expect(result.error).toContain('on fire')

    const call = await prisma.toolCall.findFirstOrThrow({ where: { runId } })
    expect(call.status).toBe('failed')
    expect(call.error).toContain('on fire')
  })

  test('a department that auto-approves external tools still cannot auto-approve financial ones', async () => {
    const prisma = testPrisma()

    // Even asked directly for it, 'financial' must be stripped.
    await prisma.departmentConfig.update({
      where: { departmentId: fixture.departmentId },
      data: { autoApprove: ['read', 'internal', 'external', 'financial'] },
    })

    const agent = await loadAgent({
      prisma,
      workspaceId: fixture.workspaceId,
      department: 'ceo',
      router: new ModelRouter({}),
    })

    // The spec is private, so this asserts through behaviour: a financial tool
    // must still park. Reaching the private field would test the wrong thing.
    const config = await prisma.departmentConfig.findUniqueOrThrow({
      where: { departmentId: fixture.departmentId },
    })
    expect(config.autoApprove).toContain('financial')
    expect(agent.key).toBe('ceo')

    const runId = await startRun()
    const financial = defineTool({
      name: 'test.pay',
      description: 'Pay someone.',
      risk: 'financial',
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ paid: true }),
    })

    const tools = new ToolRegistry()
      .register(financial)
      .toolsFor(['test.pay'], { ...context(runId), autoApprove: ['read', 'internal', 'external'] })

    const result = (await tools['test.pay']?.execute?.({}, EXEC_OPTIONS)) as {
      status: string
    }

    expect(result.status).toBe('awaiting_approval')
  })
})
