import { z } from 'zod'

import { defineTool, type NexusTool } from '../registry'

/**
 * Support tools.
 *
 * Support is where a plausible wrong answer does the most damage, because the
 * person reading it already trusted the company. So drafting is `internal` and
 * sending is `external`, and escalation is a first-class action rather than a
 * fallback.
 */
export function createSupportTools(): NexusTool<z.ZodType>[] {
  const listTickets = defineTool({
    name: 'ticket.list',
    description: 'List tickets and their state. Start here.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({
      status: z
        .enum(['open', 'waiting_on_customer', 'waiting_on_us', 'escalated', 'resolved', 'closed'])
        .optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    execute: async (input, context) => {
      const tickets = await context.prisma.ticket.findMany({
        where: {
          workspaceId: context.workspaceId,
          ...(input.status === undefined ? {} : { status: input.status }),
        },
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          summary: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      })

      return {
        count: tickets.length,
        tickets: tickets.map((ticket) => ({
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          summary: ticket.summary,
          messages: ticket._count.messages,
          updatedAt: ticket.updatedAt.toISOString(),
        })),
      }
    },
  })

  const readTicket = defineTool({
    name: 'ticket.read',
    description:
      'Read a whole thread. Read it before drafting — answering the question that was actually ' +
      'asked requires knowing what was asked.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({ ticketId: z.uuid() }),
    execute: async (input, context) => {
      const ticket = await context.prisma.ticket.findFirst({
        where: { id: input.ticketId, workspaceId: context.workspaceId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })

      if (!ticket) return { status: 'not_found' as const }

      return {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        messages: ticket.messages.map((message) => ({
          author: message.author,
          body: message.body,
          isDraft: message.isDraft,
          at: message.createdAt.toISOString(),
        })),
      }
    },
  })

  const draftReply = defineTool({
    name: 'reply.draft',
    description:
      'Draft a reply. Match the customer’s register. Never describe what their account probably ' +
      'shows — if you do not know, say you will check.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      ticketId: z.uuid(),
      body: z.string().min(10),
    }),
    execute: async (input, context) => {
      const ticket = await context.prisma.ticket.findFirst({
        where: { id: input.ticketId, workspaceId: context.workspaceId },
        select: { id: true },
      })

      if (!ticket) return { status: 'not_found' as const }

      const message = await context.prisma.ticketMessage.create({
        data: {
          ticketId: input.ticketId,
          author: 'agent',
          body: input.body,
          isDraft: true,
        },
        select: { id: true },
      })

      return {
        messageId: message.id,
        note: 'Drafted. It is not sent — the operator reads it first.',
      }
    },
  })

  const sendReply = defineTool({
    name: 'reply.send',
    description:
      'Request permission to send a reply to a customer. This does NOT send it. Support is where ' +
      'a confident wrong answer costs the most trust, so a human reads every one.',
    risk: 'external',
    permission: 'task:update',
    inputSchema: z.object({
      ticketId: z.uuid(),
      messageId: z.uuid().describe('The draft to send.'),
    }),
    describe: () => ({
      title: 'Send a reply to a customer',
      summary:
        'Support has drafted a reply. Read it before allowing it — it goes to a real customer ' +
        'under your name and cannot be recalled.',
    }),
    execute: async (input, context) => {
      const now = new Date()

      await context.prisma.ticketMessage.update({
        where: { id: input.messageId },
        data: { isDraft: false, sentAt: now },
      })

      const ticket = await context.prisma.ticket.findUniqueOrThrow({
        where: { id: input.ticketId },
        select: { firstReplyAt: true },
      })

      await context.prisma.ticket.update({
        where: { id: input.ticketId },
        data: {
          status: 'waiting_on_customer',
          // Only the first, so the metric means what it says.
          ...(ticket.firstReplyAt === null ? { firstReplyAt: now } : {}),
        },
      })

      return {
        messageId: input.messageId,
        note: 'Approved and marked sent. No mail connector is wired, so it has not physically left.',
      }
    },
  })

  const escalate = defineTool({
    name: 'ticket.escalate',
    description:
      'Escalate a ticket to the operator with a reason. Escalate anything involving money, data ' +
      'loss, security, or a customer who is clearly angry. Those are not efficiency problems.',
    risk: 'internal',
    permission: 'task:update',
    inputSchema: z.object({
      ticketId: z.uuid(),
      reason: z.string().min(10).max(500),
    }),
    execute: async (input, context) => {
      const ticket = await context.prisma.ticket.findFirst({
        where: { id: input.ticketId, workspaceId: context.workspaceId },
        select: { id: true, subject: true },
      })

      if (!ticket) return { status: 'not_found' as const }

      await context.prisma.ticket.update({
        where: { id: input.ticketId },
        data: { status: 'escalated', escalationReason: input.reason, priority: 'high' },
      })

      // A notification, not an approval: escalating asks for attention, it does
      // not ask for permission.
      await context.prisma.notification.create({
        data: {
          workspaceId: context.workspaceId,
          level: 'warning',
          title: 'Support escalated a ticket',
          body: `${ticket.subject} — ${input.reason}`,
          href: '/departments/support',
        },
      })

      return { ticketId: input.ticketId, escalated: true }
    },
  })

  const writeArticle = defineTool({
    name: 'kb.write',
    description:
      'Write or update a knowledge base article. Do this when a question has come up more than ' +
      'once — and say that you noticed the pattern.',
    risk: 'internal',
    permission: 'memory:create',
    inputSchema: z.object({
      title: z.string().min(5).max(200),
      body: z.string().min(50),
      publish: z.boolean().default(false),
    }),
    execute: async (input, context) => {
      const article = await context.prisma.kbArticle.upsert({
        where: { workspaceId_title: { workspaceId: context.workspaceId, title: input.title } },
        update: { body: input.body, published: input.publish },
        create: {
          workspaceId: context.workspaceId,
          title: input.title,
          body: input.body,
          published: input.publish,
        },
        select: { id: true, published: true },
      })

      return { articleId: article.id, published: article.published }
    },
  })

  const searchKb = defineTool({
    name: 'kb.search',
    description: 'Search the knowledge base before writing a new answer from scratch.',
    risk: 'read',
    permission: 'memory:read',
    inputSchema: z.object({ query: z.string().min(2) }),
    execute: async (input, context) => {
      const articles = await context.prisma.kbArticle.findMany({
        where: {
          workspaceId: context.workspaceId,
          OR: [
            { title: { contains: input.query, mode: 'insensitive' } },
            { body: { contains: input.query, mode: 'insensitive' } },
          ],
        },
        orderBy: { useCount: 'desc' },
        take: 5,
        select: { id: true, title: true, body: true, useCount: true },
      })

      return { count: articles.length, articles }
    },
  })

  return [
    listTickets,
    readTicket,
    draftReply,
    sendReply,
    escalate,
    writeArticle,
    searchKb,
  ] as NexusTool<z.ZodType>[]
}
