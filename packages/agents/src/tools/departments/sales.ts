import { z } from 'zod'

import { defineTool, type NexusTool } from '../registry'

/**
 * Sales tools.
 *
 * Everything that records or scores is `internal`. Sending is `external`, because
 * outreach reaches a real person under the operator's name — and once sent it
 * cannot be unsent, which is the whole test for whether a gate belongs.
 *
 * `contact.score` demands a reason alongside the number. A lead score nobody can
 * explain in one sentence is a number that will quietly mislead the forecast.
 */
export function createSalesTools(): NexusTool<z.ZodType>[] {
  const upsertContact = defineTool({
    name: 'contact.upsert',
    description:
      'Create or update a prospect. Match on email when you have one. Record where they came from.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      name: z.string().min(2).max(200),
      email: z.email().optional(),
      role: z.string().max(120).optional(),
      companyName: z.string().max(200).optional(),
      linkedinUrl: z.url().optional(),
      source: z.enum(['inbound', 'research', 'referral', 'import', 'other']).optional(),
      notes: z.string().max(2000).optional(),
    }),
    execute: async (input, context) => {
      const company = input.companyName
        ? await context.prisma.company.upsert({
            where: {
              workspaceId_name: { workspaceId: context.workspaceId, name: input.companyName },
            },
            update: {},
            create: { workspaceId: context.workspaceId, name: input.companyName },
            select: { id: true },
          })
        : null

      const data = {
        name: input.name,
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.linkedinUrl === undefined ? {} : { linkedinUrl: input.linkedinUrl }),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(company === null ? {} : { companyId: company.id }),
      }

      // Email is the natural key when present; without one, a name collision is
      // the operator's problem to resolve rather than ours to guess at.
      const contact = input.email
        ? await context.prisma.contact.upsert({
            where: { workspaceId_email: { workspaceId: context.workspaceId, email: input.email } },
            update: data,
            create: { workspaceId: context.workspaceId, email: input.email, ...data },
            select: { id: true, name: true, score: true },
          })
        : await context.prisma.contact.create({
            data: { workspaceId: context.workspaceId, ...data },
            select: { id: true, name: true, score: true },
          })

      return { contactId: contact.id, name: contact.name, score: contact.score }
    },
  })

  const scoreContact = defineTool({
    name: 'contact.score',
    description:
      'Score a prospect 0-100 and say why in one sentence. The reason is not optional — a score ' +
      'you cannot justify will mislead the forecast that depends on it.',
    risk: 'internal',
    permission: 'task:update',
    inputSchema: z.object({
      contactId: z.uuid(),
      score: z.number().int().min(0).max(100),
      reason: z.string().min(10).max(400),
    }),
    execute: async (input, context) => {
      const existing = await context.prisma.contact.findFirst({
        where: { id: input.contactId, workspaceId: context.workspaceId },
        select: { id: true, score: true },
      })

      if (!existing) return { status: 'not_found' as const }

      await context.prisma.contact.update({
        where: { id: input.contactId },
        data: { score: input.score, scoreReason: input.reason },
      })

      return { contactId: input.contactId, from: existing.score, to: input.score }
    },
  })

  const upsertDeal = defineTool({
    name: 'deal.upsert',
    description:
      'Create or move a deal. Value is in whole currency units. Probability is your honest read, ' +
      'not an aspiration — the forecast is only as good as this number.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      dealId: z.uuid().optional().describe('Omit to create.'),
      title: z.string().min(3).max(200),
      contactId: z.uuid().optional(),
      stage: z.enum(['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']),
      value: z.number().min(0).describe('Whole currency units, e.g. 4900 for €4,900.'),
      probability: z.number().int().min(0).max(100),
      expectedCloseAt: z.string().datetime().optional(),
      lostReason: z.string().max(400).optional(),
    }),
    execute: async (input, context) => {
      const data = {
        title: input.title,
        stage: input.stage,
        // Cents, converted at the boundary. Money never travels as a float.
        valueCents: Math.round(input.value * 100),
        probability: input.probability,
        ...(input.contactId === undefined ? {} : { contactId: input.contactId }),
        ...(input.expectedCloseAt === undefined
          ? {}
          : { expectedCloseAt: new Date(input.expectedCloseAt) }),
        ...(input.lostReason === undefined ? {} : { lostReason: input.lostReason }),
        ...(input.stage === 'won' || input.stage === 'lost' ? { closedAt: new Date() } : {}),
      }

      const deal = input.dealId
        ? await context.prisma.deal.update({
            where: { id: input.dealId },
            data,
            select: { id: true, stage: true, valueCents: true },
          })
        : await context.prisma.deal.create({
            data: { workspaceId: context.workspaceId, ...data },
            select: { id: true, stage: true, valueCents: true },
          })

      return { dealId: deal.id, stage: deal.stage, value: deal.valueCents / 100 }
    },
  })

  const pipeline = defineTool({
    name: 'pipeline.read',
    description:
      'Read the pipeline: open deals by stage, weighted value, and anything that has gone quiet. ' +
      'Read this before forecasting.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const deals = await context.prisma.deal.findMany({
        where: { workspaceId: context.workspaceId, stage: { notIn: ['won', 'lost'] } },
        orderBy: { valueCents: 'desc' },
        select: {
          id: true,
          title: true,
          stage: true,
          valueCents: true,
          probability: true,
          expectedCloseAt: true,
          updatedAt: true,
        },
      })

      const staleAfter = Date.now() - 21 * 24 * 60 * 60 * 1000

      return {
        open: deals.length,
        totalValue: deals.reduce((sum, deal) => sum + deal.valueCents, 0) / 100,
        // The weighted figure is the honest one; the raw total is what people
        // quote when they want a bigger number.
        weightedValue:
          deals.reduce((sum, deal) => sum + (deal.valueCents * deal.probability) / 100, 0) / 100,
        byStage: Object.fromEntries(
          ['lead', 'qualified', 'proposal', 'negotiation'].map((stage) => [
            stage,
            deals.filter((deal) => deal.stage === stage).length,
          ]),
        ),
        /** Untouched for three weeks. Not "in progress", whatever the stage says. */
        stale: deals
          .filter((deal) => deal.updatedAt.getTime() < staleAfter)
          .map((deal) => ({ id: deal.id, title: deal.title, stage: deal.stage })),
        deals: deals.slice(0, 20).map((deal) => ({
          id: deal.id,
          title: deal.title,
          stage: deal.stage,
          value: deal.valueCents / 100,
          probability: deal.probability,
          expectedCloseAt: deal.expectedCloseAt?.toISOString().slice(0, 10) ?? null,
        })),
      }
    },
  })

  const draftSequence = defineTool({
    name: 'sequence.draft',
    description:
      'Draft an outreach sequence. Personalise on something real about the recipient — a merge ' +
      'field is not personalisation. Nothing is sent by this tool.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      name: z.string().min(3).max(120),
      description: z.string().max(500).optional(),
      steps: z
        .array(
          z.object({
            delayDays: z.number().int().min(0).max(60),
            channel: z.enum(['email', 'linkedin']).default('email'),
            subject: z.string().max(200).optional(),
            body: z.string().min(10),
          }),
        )
        .min(1)
        .max(6),
    }),
    execute: async (input, context) => {
      const sequence = await context.prisma.sequence.upsert({
        where: { workspaceId_name: { workspaceId: context.workspaceId, name: input.name } },
        update: {
          ...(input.description === undefined ? {} : { description: input.description }),
        },
        create: {
          workspaceId: context.workspaceId,
          name: input.name,
          // Never active on creation: an active sequence with no human review is
          // a scheduled mistake.
          active: false,
          ...(input.description === undefined ? {} : { description: input.description }),
        },
        select: { id: true },
      })

      // Replace rather than append, so re-drafting corrects the sequence instead
      // of doubling it.
      await context.prisma.sequenceStep.deleteMany({ where: { sequenceId: sequence.id } })

      for (const [index, step] of input.steps.entries()) {
        await context.prisma.sequenceStep.create({
          data: {
            sequenceId: sequence.id,
            index,
            delayDays: step.delayDays,
            channel: step.channel,
            body: step.body,
            ...(step.subject === undefined ? {} : { subject: step.subject }),
          },
        })
      }

      return {
        sequenceId: sequence.id,
        steps: input.steps.length,
        active: false,
        note: 'Drafted and inactive. Enrolling anyone still needs approval.',
      }
    },
  })

  const sendOutreach = defineTool({
    name: 'outreach.send',
    description:
      'Request permission to send outreach to a prospect. This does NOT send — it asks the ' +
      'operator, who reads the message first.',
    risk: 'external',
    permission: 'task:update',
    inputSchema: z.object({
      contactId: z.uuid(),
      channel: z.enum(['email', 'linkedin']),
      subject: z.string().max(200).optional(),
      body: z.string().min(20),
    }),
    describe: (input) => ({
      title: `Send ${input.channel} outreach`,
      summary:
        `Sales wants to contact a prospect by ${input.channel}. ` +
        `Read it before allowing it — this arrives from you, and cannot be recalled.`,
    }),
    execute: async (input, context) => {
      // Reached only after approval. Recorded as an activity; no connector is
      // wired yet, so nothing physically leaves.
      const activity = await context.prisma.activity.create({
        data: {
          workspaceId: context.workspaceId,
          contactId: input.contactId,
          kind: input.channel === 'email' ? 'email' : 'message',
          direction: 'out',
          summary: input.subject ?? `Outreach via ${input.channel}`,
          body: input.body,
          occurredAt: new Date(),
        },
        select: { id: true },
      })

      return {
        activityId: activity.id,
        note: 'Approved and logged. No channel is connected, so it has not physically been sent.',
      }
    },
  })

  const logActivity = defineTool({
    name: 'activity.log',
    description:
      'Record something that happened with a prospect — a call, a reply, a meeting. Record what ' +
      'happened, not what you hope happens next.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      contactId: z.uuid().optional(),
      dealId: z.uuid().optional(),
      kind: z.enum(['note', 'email', 'call', 'meeting', 'message']),
      direction: z.enum(['in', 'out', 'internal']),
      summary: z.string().min(3).max(300),
      body: z.string().max(4000).optional(),
      occurredAt: z.string().datetime().optional(),
    }),
    execute: async (input, context) => {
      const activity = await context.prisma.activity.create({
        data: {
          workspaceId: context.workspaceId,
          kind: input.kind,
          direction: input.direction,
          summary: input.summary,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          ...(input.contactId === undefined ? {} : { contactId: input.contactId }),
          ...(input.dealId === undefined ? {} : { dealId: input.dealId }),
          ...(input.body === undefined ? {} : { body: input.body }),
        },
        select: { id: true },
      })

      return { activityId: activity.id }
    },
  })

  return [
    upsertContact,
    scoreContact,
    upsertDeal,
    pipeline,
    draftSequence,
    sendOutreach,
    logActivity,
  ] as NexusTool<z.ZodType>[]
}
