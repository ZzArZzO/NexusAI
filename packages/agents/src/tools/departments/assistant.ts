import { z } from 'zod'

import { defineTool, type NexusTool } from '../registry'

/**
 * Personal assistant tools.
 *
 * The interesting risk boundary here is the calendar: an event with no other
 * attendees is `internal` — it only rearranges the operator's own day. Add one
 * attendee and it becomes `external`, because it puts an invitation in someone
 * else's inbox. The tool decides which, from the input, rather than having two
 * near-identical tools the model must choose between correctly.
 */
export function createAssistantTools(): NexusTool<z.ZodType>[] {
  const readAgenda = defineTool({
    name: 'agenda.read',
    description:
      'Read the day: events, reminders due, and tasks. Read this before saying what is on — and ' +
      'do not pad it to look productive.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({ days: z.number().int().min(1).max(14).default(1) }),
    execute: async (input, context) => {
      const from = new Date()
      const to = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000)

      const [events, reminders, tasks] = await Promise.all([
        context.prisma.calendarEvent.findMany({
          where: { workspaceId: context.workspaceId, startsAt: { gte: from, lte: to } },
          orderBy: { startsAt: 'asc' },
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            attendees: true,
            location: true,
          },
        }),
        context.prisma.reminder.findMany({
          where: { workspaceId: context.workspaceId, completedAt: null, dueAt: { lte: to } },
          orderBy: { dueAt: 'asc' },
          select: { id: true, body: true, dueAt: true },
        }),
        context.prisma.task.findMany({
          where: {
            workspaceId: context.workspaceId,
            status: { notIn: ['done', 'cancelled'] },
            dueAt: { lte: to },
          },
          orderBy: { dueAt: 'asc' },
          take: 10,
          select: { id: true, title: true, dueAt: true, priority: true },
        }),
      ])

      /**
       * Gaps between meetings, so scheduling can defend contiguous blocks rather
       * than filling holes. A day of fragments produces nothing.
       */
      const blocks: { from: string; to: string; minutes: number }[] = []
      for (let i = 0; i < events.length - 1; i += 1) {
        const gapStart = events[i]?.endsAt
        const gapEnd = events[i + 1]?.startsAt
        if (!gapStart || !gapEnd) continue

        const minutes = Math.round((gapEnd.getTime() - gapStart.getTime()) / 60000)
        if (minutes >= 60) {
          blocks.push({ from: gapStart.toISOString(), to: gapEnd.toISOString(), minutes })
        }
      }

      return {
        events: events.map((event) => ({
          id: event.id,
          title: event.title,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
          attendees: event.attendees.length,
          location: event.location,
        })),
        reminders: reminders.map((reminder) => ({
          id: reminder.id,
          body: reminder.body,
          dueAt: reminder.dueAt.toISOString(),
          overdue: reminder.dueAt.getTime() < Date.now(),
        })),
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.title,
          priority: task.priority,
          dueAt: task.dueAt?.toISOString() ?? null,
        })),
        freeBlocks: blocks,
      }
    },
  })

  const createEvent = defineTool({
    name: 'calendar.create',
    description:
      'Put something on the calendar. With no attendees this happens immediately — it only moves ' +
      'the operator’s own time. With attendees it needs approval, because it lands in someone ' +
      'else’s inbox.',
    /**
     * The tier is fixed at `external`, because a tool's risk cannot depend on its
     * input — the gate is decided before execute runs. Blocking your own time
     * therefore goes through `calendar.block` instead, which is genuinely internal.
     */
    risk: 'external',
    permission: 'task:create',
    inputSchema: z.object({
      title: z.string().min(2).max(200),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      attendees: z.array(z.email()).min(1).describe('Use calendar.block if there are none.'),
      location: z.string().max(200).optional(),
      description: z.string().max(2000).optional(),
    }),
    describe: (input) => ({
      title: `Invite ${input.attendees.length} to "${input.title}"`,
      summary:
        `This sends a calendar invitation to ${input.attendees.join(', ')}. ` +
        `Other people's calendars are the outside world.`,
    }),
    execute: async (input, context) => {
      const event = await context.prisma.calendarEvent.create({
        data: {
          workspaceId: context.workspaceId,
          title: input.title,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          attendees: input.attendees,
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.description === undefined ? {} : { description: input.description }),
        },
        select: { id: true },
      })

      return {
        eventId: event.id,
        note: 'Recorded. No calendar is connected, so no invitation has physically been sent.',
      }
    },
  })

  const blockTime = defineTool({
    name: 'calendar.block',
    description:
      'Block the operator’s own time — focus, travel, a reminder to eat. No attendees, so nobody ' +
      'else is affected and this happens immediately. Prefer long contiguous blocks.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      title: z.string().min(2).max(200),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      allDay: z.boolean().default(false),
    }),
    execute: async (input, context) => {
      const event = await context.prisma.calendarEvent.create({
        data: {
          workspaceId: context.workspaceId,
          title: input.title,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          allDay: input.allDay,
          attendees: [],
        },
        select: { id: true },
      })

      return { eventId: event.id }
    },
  })

  const writeNote = defineTool({
    name: 'note.create',
    description:
      'Capture a note, an idea, or meeting minutes. For a meeting, record decisions and owners — ' +
      'not a transcript.',
    risk: 'internal',
    permission: 'memory:create',
    inputSchema: z.object({
      title: z.string().min(2).max(200),
      body: z.string().min(5),
      kind: z.enum(['note', 'idea', 'meeting', 'journal']).default('note'),
      tags: z.array(z.string().max(40)).max(8).default([]),
    }),
    execute: async (input, context) => {
      const note = await context.prisma.note.create({
        data: {
          workspaceId: context.workspaceId,
          title: input.title,
          body: input.body,
          kind: input.kind,
          tags: input.tags,
        },
        select: { id: true },
      })

      return {
        noteId: note.id,
        note: 'Captured. Use memory.write as well if this is worth recalling months from now.',
      }
    },
  })

  const setReminder = defineTool({
    name: 'reminder.create',
    description: 'Set a reminder for a specific time.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      body: z.string().min(3).max(400),
      dueAt: z.string().datetime(),
    }),
    execute: async (input, context) => {
      const reminder = await context.prisma.reminder.create({
        data: {
          workspaceId: context.workspaceId,
          body: input.body,
          dueAt: new Date(input.dueAt),
        },
        select: { id: true },
      })

      return { reminderId: reminder.id }
    },
  })

  const searchNotes = defineTool({
    name: 'note.search',
    description:
      'Search notes and ideas. Use this to surface something captured weeks ago that is relevant ' +
      'now — a note nobody ever mentions again may as well not exist.',
    risk: 'read',
    permission: 'memory:read',
    inputSchema: z.object({
      query: z.string().min(2),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    execute: async (input, context) => {
      const notes = await context.prisma.note.findMany({
        where: {
          workspaceId: context.workspaceId,
          OR: [
            { title: { contains: input.query, mode: 'insensitive' } },
            { body: { contains: input.query, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: { id: true, title: true, body: true, kind: true, createdAt: true },
      })

      return {
        count: notes.length,
        notes: notes.map((note) => ({
          ...note,
          createdAt: note.createdAt.toISOString().slice(0, 10),
        })),
      }
    },
  })

  return [
    readAgenda,
    createEvent,
    blockTime,
    writeNote,
    setReminder,
    searchNotes,
  ] as NexusTool<z.ZodType>[]
}
