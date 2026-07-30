import { z } from 'zod'

import { defineTool, type NexusTool } from '../registry'

/**
 * Marketing tools.
 *
 * Drafting is `internal`. Publishing is `external` — it is the moment the
 * company's words become public in the operator's name, which is exactly the
 * class of action the gate exists for. Note that `content.publish` does not
 * actually publish: it requests permission to, and a connector does the posting
 * once a human has agreed.
 */

const FORMATS = [
  'tweet',
  'thread',
  'linkedin',
  'instagram',
  'tiktok',
  'youtube',
  'blog',
  'newsletter',
] as const

export function createMarketingTools(): NexusTool<z.ZodType>[] {
  const createContent = defineTool({
    name: 'content.create',
    description:
      'Create a piece of content. Write it in the operator’s voice — study what they have written ' +
      'before, which is in memory. One idea per piece. No hype vocabulary.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      format: z.enum(FORMATS),
      title: z.string().min(3).max(200).describe('For your own reference, not a headline.'),
      body: z.string().min(10),
      hook: z
        .string()
        .max(300)
        .optional()
        .describe('The opening line. Worth iterating on separately from the body.'),
      callToAction: z.string().max(300).optional(),
      campaignName: z.string().optional(),
    }),
    execute: async (input, context) => {
      const campaign = input.campaignName
        ? await context.prisma.campaign.findFirst({
            where: { workspaceId: context.workspaceId, name: { contains: input.campaignName } },
            select: { id: true },
          })
        : null

      const item = await context.prisma.contentItem.create({
        data: {
          workspaceId: context.workspaceId,
          format: input.format,
          title: input.title,
          body: input.body,
          status: 'drafting',
          ...(input.hook === undefined ? {} : { hook: input.hook }),
          ...(input.callToAction === undefined ? {} : { callToAction: input.callToAction }),
          ...(campaign === null ? {} : { campaignId: campaign.id }),
        },
        select: { id: true, format: true, status: true },
      })

      return {
        contentId: item.id,
        format: item.format,
        status: item.status,
        note: 'Drafted. Nothing is published until the operator approves it.',
      }
    },
  })

  const updateContent = defineTool({
    name: 'content.update',
    description:
      'Revise a draft, or move it along the pipeline. You may move it as far as `review`; only ' +
      'the operator moves anything to `approved` or beyond.',
    risk: 'internal',
    permission: 'task:update',
    inputSchema: z.object({
      contentId: z.uuid(),
      body: z.string().min(10).optional(),
      hook: z.string().max(300).optional(),
      /**
       * Deliberately excludes `approved`, `scheduled` and `published`. An agent
       * that can mark its own work approved has no gate at all.
       */
      status: z.enum(['idea', 'drafting', 'review', 'archived']).optional(),
    }),
    execute: async (input, context) => {
      const existing = await context.prisma.contentItem.findFirst({
        where: { id: input.contentId, workspaceId: context.workspaceId },
        select: { id: true },
      })

      if (!existing) return { status: 'not_found' as const }

      const item = await context.prisma.contentItem.update({
        where: { id: input.contentId },
        data: {
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.hook === undefined ? {} : { hook: input.hook }),
          ...(input.status === undefined ? {} : { status: input.status }),
        },
        select: { id: true, status: true },
      })

      return { contentId: item.id, status: item.status }
    },
  })

  const listContent = defineTool({
    name: 'content.list',
    description: 'List content and where each piece is in the pipeline.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({
      status: z
        .enum(['idea', 'drafting', 'review', 'approved', 'scheduled', 'published', 'archived'])
        .optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    execute: async (input, context) => {
      const items = await context.prisma.contentItem.findMany({
        where: {
          workspaceId: context.workspaceId,
          ...(input.status === undefined ? {} : { status: input.status }),
        },
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
        select: { id: true, format: true, title: true, status: true, hook: true },
      })

      return { count: items.length, content: items }
    },
  })

  const schedule = definePlanTool()

  const publish = defineTool({
    name: 'content.publish',
    description:
      'Request permission to publish a piece of content. This does NOT publish it — it asks the ' +
      'operator. Nothing goes out until they agree.',
    risk: 'external',
    permission: 'task:update',
    inputSchema: z.object({
      contentId: z.uuid(),
      channel: z.string().min(2),
      /** Omitted means "as soon as approved". */
      scheduledFor: z.string().datetime().optional(),
    }),
    describe: (input) => ({
      title: `Publish to ${input.channel}`,
      summary:
        `Marketing wants to publish a piece of content to ${input.channel}` +
        `${input.scheduledFor ? ` at ${input.scheduledFor}` : ' as soon as you approve'}. ` +
        `Review the text before allowing it — this becomes public in your name.`,
    }),
    execute: async (input, context) => {
      // Reached only after approval. The slot is recorded as awaiting the
      // connector rather than as published, because this code does not post.
      const slot = await context.prisma.scheduleSlot.create({
        data: {
          workspaceId: context.workspaceId,
          contentItemId: input.contentId,
          channel: input.channel,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : new Date(),
          status: 'awaiting_approval',
        },
        select: { id: true, scheduledFor: true },
      })

      await context.prisma.contentItem.update({
        where: { id: input.contentId },
        data: { status: 'scheduled' },
      })

      return {
        slotId: slot.id,
        scheduledFor: slot.scheduledFor.toISOString(),
        note: 'Scheduled. The connector posts it; no channel is connected yet.',
      }
    },
  })

  return [createContent, updateContent, listContent, schedule, publish] as NexusTool<z.ZodType>[]
}

/**
 * Planning the calendar is internal — a plan is not a post. Kept as its own
 * function purely to keep the list above readable.
 */
function definePlanTool() {
  return defineTool({
    name: 'content.plan',
    description:
      'Plan when a piece of content should go out. This only records the intention; publishing ' +
      'still needs its own approval.',
    risk: 'internal',
    permission: 'task:update',
    inputSchema: z.object({
      contentId: z.uuid(),
      channel: z.string().min(2),
      scheduledFor: z.string().datetime(),
    }),
    execute: async (input, context) => {
      const slot = await context.prisma.scheduleSlot.create({
        data: {
          workspaceId: context.workspaceId,
          contentItemId: input.contentId,
          channel: input.channel,
          scheduledFor: new Date(input.scheduledFor),
          status: 'planned',
        },
        select: { id: true },
      })

      return { slotId: slot.id, status: 'planned' as const }
    },
  })
}
