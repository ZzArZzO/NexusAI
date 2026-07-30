import { z } from 'zod'

import { defineTool, type NexusTool } from '../registry'

/**
 * Finance tools.
 *
 * Recording and forecasting are `internal`. Anything that moves money is
 * `financial`, which means an approval gate *and* a second confirmation — two
 * deliberate acts, because there is no such thing as a routine payment.
 *
 * Every amount crosses this boundary in whole currency units and is stored in
 * integer cents. A float somewhere in a ledger is a rounding error waiting for a
 * year-end.
 */
export function createFinanceTools(): NexusTool<z.ZodType>[] {
  const recordTransaction = defineTool({
    name: 'transaction.record',
    description:
      'Record money in or out. Amount is always positive — `direction` carries the sign. Use the ' +
      'external id when importing, so re-importing the same statement changes nothing.',
    risk: 'internal',
    permission: 'kpi:update',
    inputSchema: z.object({
      direction: z.enum(['in', 'out']),
      amount: z.number().positive().describe('Whole currency units, e.g. 49.90'),
      description: z.string().min(3).max(300),
      category: z.string().max(80).optional(),
      occurredAt: z.string().datetime().optional(),
      source: z.enum(['stripe', 'import', 'manual']).default('manual'),
      externalId: z.string().max(200).optional(),
    }),
    execute: async (input, context) => {
      const amountCents = Math.round(input.amount * 100)
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()

      // Upsert on (workspace, source, externalId) when an id is available, so an
      // import run twice does not double the month's revenue.
      if (input.externalId) {
        const transaction = await context.prisma.transaction.upsert({
          where: {
            workspaceId_source_externalId: {
              workspaceId: context.workspaceId,
              source: input.source,
              externalId: input.externalId,
            },
          },
          update: { amountCents, description: input.description, occurredAt },
          create: {
            workspaceId: context.workspaceId,
            direction: input.direction,
            amountCents,
            description: input.description,
            occurredAt,
            source: input.source,
            externalId: input.externalId,
            ...(input.category === undefined ? {} : { category: input.category }),
          },
          select: { id: true },
        })

        return { transactionId: transaction.id, deduplicated: true }
      }

      const transaction = await context.prisma.transaction.create({
        data: {
          workspaceId: context.workspaceId,
          direction: input.direction,
          amountCents,
          description: input.description,
          occurredAt,
          source: input.source,
          ...(input.category === undefined ? {} : { category: input.category }),
        },
        select: { id: true },
      })

      return { transactionId: transaction.id, deduplicated: false }
    },
  })

  const readLedger = defineTool({
    name: 'ledger.read',
    description:
      'Read the money: cash position, income and spend over a window, and spend by category. ' +
      'Read this before saying anything about money — a figure you have not traced is a rumour.',
    risk: 'read',
    permission: 'kpi:read',
    inputSchema: z.object({
      days: z.number().int().min(1).max(365).default(30),
    }),
    execute: async (input, context) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)

      const [income, spend, byCategory, subscriptions, allTime] = await Promise.all([
        context.prisma.transaction.aggregate({
          where: { workspaceId: context.workspaceId, direction: 'in', occurredAt: { gte: since } },
          _sum: { amountCents: true },
          _count: true,
        }),
        context.prisma.transaction.aggregate({
          where: { workspaceId: context.workspaceId, direction: 'out', occurredAt: { gte: since } },
          _sum: { amountCents: true },
          _count: true,
        }),
        context.prisma.transaction.groupBy({
          by: ['category'],
          where: { workspaceId: context.workspaceId, direction: 'out', occurredAt: { gte: since } },
          _sum: { amountCents: true },
        }),
        context.prisma.subscription.findMany({
          where: { workspaceId: context.workspaceId, cancelledAt: null },
          select: { name: true, amountCents: true, interval: true, direction: true },
        }),
        // Cash is derived from the whole ledger, not the window — a 30-day view
        // of cash is not cash.
        context.prisma.transaction.groupBy({
          by: ['direction'],
          where: { workspaceId: context.workspaceId },
          _sum: { amountCents: true },
        }),
      ])

      const inAll = allTime.find((row) => row.direction === 'in')?._sum.amountCents ?? 0
      const outAll = allTime.find((row) => row.direction === 'out')?._sum.amountCents ?? 0

      const monthlyRecurring = subscriptions.reduce((sum, sub) => {
        const monthly = sub.interval === 'yearly' ? sub.amountCents / 12 : sub.amountCents
        return sum + (sub.direction === 'out' ? monthly : 0)
      }, 0)

      return {
        windowDays: input.days,
        cash: (inAll - outAll) / 100,
        income: (income._sum.amountCents ?? 0) / 100,
        spend: (spend._sum.amountCents ?? 0) / 100,
        net: ((income._sum.amountCents ?? 0) - (spend._sum.amountCents ?? 0)) / 100,
        transactions: income._count + spend._count,
        monthlyRecurringCost: monthlyRecurring / 100,
        spendByCategory: byCategory
          .map((row) => ({
            category: row.category ?? 'uncategorised',
            amount: (row._sum.amountCents ?? 0) / 100,
          }))
          .sort((a, b) => b.amount - a.amount),
      }
    },
  })

  const flagAnomaly = defineTool({
    name: 'transaction.flag',
    description:
      'Flag a transaction that looks wrong, with the context that makes it look wrong. ' +
      '"Spending anomaly detected" is noise; "hosting is up 40% since the new environment" is useful.',
    risk: 'internal',
    permission: 'kpi:update',
    inputSchema: z.object({
      transactionId: z.uuid(),
      note: z.string().min(15).max(500),
    }),
    execute: async (input, context) => {
      const existing = await context.prisma.transaction.findFirst({
        where: { id: input.transactionId, workspaceId: context.workspaceId },
        select: { id: true },
      })

      if (!existing) return { status: 'not_found' as const }

      await context.prisma.transaction.update({
        where: { id: input.transactionId },
        data: { anomalyNote: input.note },
      })

      return { transactionId: input.transactionId, flagged: true }
    },
  })

  const forecast = defineTool({
    name: 'forecast.create',
    description:
      'Record a forecast. Method and confidence are required: a forecast that cannot be ' +
      'interrogated is a wish. Say what would have to be true for it to be wrong.',
    risk: 'internal',
    permission: 'kpi:update',
    inputSchema: z.object({
      metric: z.enum(['revenue', 'cash', 'pipeline']),
      periodStart: z.string().date(),
      periodEnd: z.string().date(),
      amount: z.number().describe('Whole currency units.'),
      confidence: z.number().int().min(0).max(100),
      method: z
        .string()
        .min(20)
        .max(1000)
        .describe('How you arrived at it, and what would break it.'),
    }),
    execute: async (input, context) => {
      const created = await context.prisma.forecast.create({
        data: {
          workspaceId: context.workspaceId,
          metric: input.metric,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          amountCents: Math.round(input.amount * 100),
          confidence: input.confidence,
          method: input.method,
        },
        select: { id: true },
      })

      return { forecastId: created.id, metric: input.metric, amount: input.amount }
    },
  })

  const trackSubscription = defineTool({
    name: 'subscription.track',
    description: 'Record a recurring cost or a recurring revenue line.',
    risk: 'internal',
    permission: 'kpi:update',
    inputSchema: z.object({
      name: z.string().min(2).max(120),
      amount: z.number().positive(),
      interval: z.enum(['monthly', 'yearly']),
      direction: z.enum(['in', 'out']),
      nextChargeAt: z.string().date().optional(),
    }),
    execute: async (input, context) => {
      const subscription = await context.prisma.subscription.upsert({
        where: { workspaceId_name: { workspaceId: context.workspaceId, name: input.name } },
        update: {
          amountCents: Math.round(input.amount * 100),
          interval: input.interval,
          direction: input.direction,
        },
        create: {
          workspaceId: context.workspaceId,
          name: input.name,
          amountCents: Math.round(input.amount * 100),
          interval: input.interval,
          direction: input.direction,
          ...(input.nextChargeAt === undefined
            ? {}
            : { nextChargeAt: new Date(input.nextChargeAt) }),
        },
        select: { id: true },
      })

      return { subscriptionId: subscription.id }
    },
  })

  const makePayment = defineTool({
    name: 'payment.send',
    description:
      'Request permission to move money — a payment, a refund, a transfer. This does NOT move ' +
      'anything. It requires the operator to approve AND then separately confirm.',
    risk: 'financial',
    permission: 'kpi:update',
    inputSchema: z.object({
      amount: z.number().positive(),
      currency: z.string().length(3).default('EUR'),
      recipient: z.string().min(2).max(200),
      reason: z.string().min(10).max(500),
    }),
    describe: (input) => ({
      title: `Pay ${input.currency} ${input.amount.toFixed(2)} to ${input.recipient}`,
      summary:
        `${input.reason}\n\nThis moves real money. Approving is the first of two steps — nothing ` +
        `happens until you confirm separately.`,
    }),
    execute: async (input, context) => {
      // Reached only after approval AND second confirmation. No payment provider
      // is connected, so this records the authorised intent rather than pretending.
      const transaction = await context.prisma.transaction.create({
        data: {
          workspaceId: context.workspaceId,
          direction: 'out',
          amountCents: Math.round(input.amount * 100),
          currency: input.currency,
          description: `${input.recipient}: ${input.reason}`,
          category: 'authorised-payment',
          source: 'manual',
          occurredAt: new Date(),
        },
        select: { id: true },
      })

      return {
        transactionId: transaction.id,
        note:
          'Authorised and recorded in the ledger. No payment provider is connected, so no money ' +
          'has actually moved — connect one before relying on this.',
      }
    },
  })

  return [
    recordTransaction,
    readLedger,
    flagAnomaly,
    forecast,
    trackSubscription,
    makePayment,
  ] as NexusTool<z.ZodType>[]
}
