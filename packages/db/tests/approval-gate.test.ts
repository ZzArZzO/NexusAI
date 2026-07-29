import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  disconnectTestDatabase,
  hasTestDatabase,
  migrateTestDatabase,
  resetDatabase,
  seedFixture,
  testPrisma,
  type Fixture,
} from './harness'

/**
 * The approval gate, enforced in Postgres.
 *
 * The application also checks this before executing anything, but application
 * checks can be bypassed by a bug, a refactor, or a future code path nobody
 * thought about. These tests assert the database refuses regardless — which is
 * the only guarantee that survives changes to the code above it.
 */
describe.skipIf(!hasTestDatabase)('approval gate (database trigger)', () => {
  let fixture: Fixture

  beforeAll(() => {
    migrateTestDatabase()
  })

  beforeEach(async () => {
    await resetDatabase()
    fixture = await seedFixture('marketing')
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function createRun() {
    const prisma = testPrisma()
    return prisma.run.create({
      data: {
        workspaceId: fixture.workspaceId,
        departmentId: fixture.departmentId,
        trigger: 'schedule',
        status: 'running',
      },
      select: { id: true },
    })
  }

  test('a read-tier tool call may succeed with no approval', async () => {
    const prisma = testPrisma()
    const run = await createRun()

    const call = await prisma.toolCall.create({
      data: {
        runId: run.id,
        toolName: 'memory.recall',
        risk: 'read',
        status: 'succeeded',
        input: {},
      },
    })

    expect(call.status).toBe('succeeded')
  })

  test('an internal-tier tool call may succeed with no approval', async () => {
    const prisma = testPrisma()
    const run = await createRun()

    const call = await prisma.toolCall.create({
      data: {
        runId: run.id,
        toolName: 'task.create',
        risk: 'internal',
        status: 'succeeded',
        input: { title: 'x' },
      },
    })

    expect(call.status).toBe('succeeded')
  })

  test('an external tool call cannot be inserted as succeeded without an approval', async () => {
    const prisma = testPrisma()
    const run = await createRun()

    await expect(
      prisma.toolCall.create({
        data: {
          runId: run.id,
          toolName: 'gmail.send',
          risk: 'external',
          status: 'succeeded',
          input: { to: 'someone@example.com' },
        },
      }),
    ).rejects.toThrow(/cannot be marked succeeded/i)
  })

  test('an external tool call may be recorded as awaiting_approval', async () => {
    const prisma = testPrisma()
    const run = await createRun()

    const call = await prisma.toolCall.create({
      data: {
        runId: run.id,
        toolName: 'gmail.send',
        risk: 'external',
        status: 'awaiting_approval',
        input: { to: 'someone@example.com' },
      },
    })

    expect(call.status).toBe('awaiting_approval')
  })

  test('a pending approval is not enough to mark the call succeeded', async () => {
    const prisma = testPrisma()
    const run = await createRun()

    const call = await prisma.toolCall.create({
      data: {
        runId: run.id,
        toolName: 'gmail.send',
        risk: 'external',
        status: 'awaiting_approval',
        input: {},
      },
    })

    await prisma.approvalRequest.create({
      data: {
        workspaceId: fixture.workspaceId,
        departmentId: fixture.departmentId,
        runId: run.id,
        toolCallId: call.id,
        status: 'pending',
        risk: 'external',
        title: 'Send email',
        summary: 'Marketing wants to email a prospect',
        payload: {},
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    await expect(
      prisma.toolCall.update({ where: { id: call.id }, data: { status: 'succeeded' } }),
    ).rejects.toThrow(/cannot be marked succeeded/i)
  })

  test('an approved request lets the external call succeed', async () => {
    const prisma = testPrisma()
    const run = await createRun()

    const call = await prisma.toolCall.create({
      data: {
        runId: run.id,
        toolName: 'gmail.send',
        risk: 'external',
        status: 'awaiting_approval',
        input: {},
      },
    })

    await prisma.approvalRequest.create({
      data: {
        workspaceId: fixture.workspaceId,
        departmentId: fixture.departmentId,
        runId: run.id,
        toolCallId: call.id,
        status: 'approved',
        risk: 'external',
        title: 'Send email',
        summary: 'Approved by the operator',
        payload: {},
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    const updated = await prisma.toolCall.update({
      where: { id: call.id },
      data: { status: 'succeeded' },
    })

    expect(updated.status).toBe('succeeded')
  })

  test('a financial call needs the second confirmation, not just approval', async () => {
    const prisma = testPrisma()
    const run = await createRun()

    const call = await prisma.toolCall.create({
      data: {
        runId: run.id,
        toolName: 'stripe.refund',
        risk: 'financial',
        status: 'awaiting_approval',
        input: { amountCents: 5000 },
      },
    })

    const approval = await prisma.approvalRequest.create({
      data: {
        workspaceId: fixture.workspaceId,
        departmentId: fixture.departmentId,
        runId: run.id,
        toolCallId: call.id,
        status: 'approved',
        risk: 'financial',
        title: 'Refund EUR 50',
        summary: 'Finance wants to refund a customer',
        payload: {},
        requiresSecondConfirmation: true,
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    // Approved but unconfirmed — still refused.
    await expect(
      prisma.toolCall.update({ where: { id: call.id }, data: { status: 'succeeded' } }),
    ).rejects.toThrow(/cannot be marked succeeded/i)

    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { secondConfirmedAt: new Date() },
    })

    const updated = await prisma.toolCall.update({
      where: { id: call.id },
      data: { status: 'succeeded' },
    })

    expect(updated.status).toBe('succeeded')
  })

  test('an approval belonging to a different tool call does not unlock this one', async () => {
    const prisma = testPrisma()
    const run = await createRun()

    const [target, decoy] = await Promise.all([
      prisma.toolCall.create({
        data: {
          runId: run.id,
          toolName: 'gmail.send',
          risk: 'external',
          status: 'awaiting_approval',
          input: { to: 'victim@example.com' },
        },
      }),
      prisma.toolCall.create({
        data: {
          runId: run.id,
          toolName: 'gmail.send',
          risk: 'external',
          status: 'awaiting_approval',
          input: { to: 'harmless@example.com' },
        },
      }),
    ])

    // The operator approved the decoy, not the target.
    await prisma.approvalRequest.create({
      data: {
        workspaceId: fixture.workspaceId,
        departmentId: fixture.departmentId,
        runId: run.id,
        toolCallId: decoy.id,
        status: 'approved',
        risk: 'external',
        title: 'Send the harmless one',
        summary: 'Approved',
        payload: {},
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    await expect(
      prisma.toolCall.update({ where: { id: target.id }, data: { status: 'succeeded' } }),
    ).rejects.toThrow(/cannot be marked succeeded/i)
  })
})
