import { canDelegate, departmentIdSchema, PLATFORM_TOOLS } from '@nexusai/core'
import { tasks as taskRepo } from '@nexusai/db'
import { z } from 'zod'

import { ingest, recall } from '../memory/index'
import type { ModelRouter } from '../models/router'
import { createAssistantTools } from './departments/assistant'
import { createEngineeringTools } from './departments/engineering'
import { createFinanceTools } from './departments/finance'
import { createMarketingTools } from './departments/marketing'
import { createOperationsTools } from './departments/operations'
import { createResearchTools } from './departments/research'
import { createSalesTools } from './departments/sales'
import { createSupportTools } from './departments/support'
import { defineTool, ToolRegistry, type NexusTool } from './registry'

/**
 * The platform tool set: what every department has, regardless of its remit.
 *
 * Memory, tasks, goals and reports are here because they are how the company
 * thinks and how it hands work between departments — a department that could not
 * recall or file anything would be a chatbot with a job title. Everything in this
 * file is `read` or `internal`; the tools that leave the system live in
 * `departments/`, one file per remit.
 */

export interface BuiltinToolOptions {
  router: ModelRouter
  /** Memory namespaces the calling department may read and write. */
  scopes: string[]
}

export function createBuiltinTools(options: BuiltinToolOptions): NexusTool<z.ZodType>[] {
  const { router, scopes } = options

  const memoryRecall = defineTool({
    name: 'memory.recall',
    description:
      'Search long-term memory for anything the company already knows. Use this BEFORE answering ' +
      'any question about goals, decisions, projects, people or history. Returns numbered chunks; ' +
      'cite them by number in your answer.',
    risk: 'read',
    permission: 'memory:read',
    inputSchema: z.object({
      query: z.string().min(2).describe('What you are looking for, in natural language.'),
      limit: z.number().int().min(1).max(20).default(6),
    }),
    execute: async (input, context) => {
      const chunks = await recall({
        prisma: context.prisma,
        router,
        workspaceId: context.workspaceId,
        query: input.query,
        scopes,
        limit: input.limit,
      })

      return {
        found: chunks.length,
        chunks: chunks.map((chunk, index) => ({
          citation: index + 1,
          id: chunk.id,
          headings: chunk.headings,
          content: chunk.content,
          // Exposed so the model can tell a strong match from a weak one and
          // hedge accordingly, rather than treating rank 6 like rank 1.
          score: Number(chunk.score.toFixed(5)),
        })),
      }
    },
  })

  const memoryWrite = defineTool({
    name: 'memory.write',
    description:
      'Record something worth remembering: a decision, a fact about the business, a preference, ' +
      'or a summary of what was discussed. Do not record trivia or restate what is already stored.',
    risk: 'internal',
    permission: 'memory:create',
    inputSchema: z.object({
      title: z.string().min(3).max(200),
      content: z.string().min(10).describe('Markdown. Write it for a reader six months from now.'),
      kind: z.enum(['note', 'report', 'research', 'meeting']).default('note'),
    }),
    execute: async (input, context) => {
      const result = await ingest({
        prisma: context.prisma,
        router,
        workspaceId: context.workspaceId,
        departmentId: context.actor.id,
        kind: input.kind,
        title: input.title,
        content: input.content,
        scopes,
      })

      return {
        documentId: result.documentId,
        chunks: result.chunks,
        // Reported rather than hidden: writing the same note twice is a
        // behaviour worth the model noticing.
        alreadyKnown: !result.changed,
      }
    },
  })

  const taskCreate = defineTool({
    name: 'task.create',
    description:
      'Create a task. Use this when work needs doing later or by someone else, rather than ' +
      'describing it in prose that nobody will act on.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      title: z.string().min(3).max(200),
      description: z.string().max(2000).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      department: departmentIdSchema
        .optional()
        .describe('Which department should do it. Omit to leave it unassigned.'),
      dueInDays: z.number().int().min(0).max(365).optional(),
    }),
    execute: async (input, context) => {
      let departmentId: string | undefined

      if (input.department) {
        if (!canDelegate(context.actor.key, input.department)) {
          return {
            status: 'refused' as const,
            reason:
              `${context.actor.key} may not delegate to ${input.department}. ` +
              `Create it unassigned, or hand it to the CEO.`,
          }
        }

        const target = await context.prisma.department.findUnique({
          where: {
            workspaceId_key: { workspaceId: context.workspaceId, key: input.department },
          },
          select: { id: true },
        })
        departmentId = target?.id
      }

      const task = await taskRepo.createTask(context.prisma, {
        workspaceId: context.workspaceId,
        title: input.title,
        priority: input.priority,
        createdByDepartmentId: context.actor.id,
        runId: context.runId,
        actor: context.actor.key,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(departmentId === undefined ? {} : { departmentId }),
        ...(input.dueInDays === undefined
          ? {}
          : { dueAt: new Date(Date.now() + input.dueInDays * 24 * 60 * 60 * 1000) }),
      })

      return { taskId: task.id, title: task.title, status: task.status }
    },
  })

  const taskUpdate = defineTool({
    name: 'task.update',
    description: 'Change a task’s status. Use it to record progress, not to invent it.',
    risk: 'internal',
    permission: 'task:update',
    inputSchema: z.object({
      taskId: z.uuid(),
      status: z.enum([
        'backlog',
        'todo',
        'in_progress',
        'blocked',
        'in_review',
        'done',
        'cancelled',
      ]),
      note: z.string().max(500).optional(),
    }),
    execute: async (input, context) => {
      const task = await taskRepo.updateTaskStatus(context.prisma, {
        taskId: input.taskId,
        status: input.status,
        actor: context.actor.key,
        ...(input.note === undefined ? {} : { note: input.note }),
      })

      return { taskId: task.id, status: task.status }
    },
  })

  const listTasks = defineTool({
    name: 'task.list',
    description: 'List tasks that are ready to work on — nothing blocking them.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(20),
      mineOnly: z.boolean().default(false).describe('Only tasks assigned to your department.'),
    }),
    execute: async (input, context) => {
      const rows = await taskRepo.findActionableTasks(context.prisma, {
        workspaceId: context.workspaceId,
        limit: input.limit,
        ...(input.mineOnly ? { departmentId: context.actor.id } : {}),
      })

      return {
        count: rows.length,
        tasks: rows.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          department: task.department?.key ?? null,
          dueAt: task.dueAt?.toISOString() ?? null,
        })),
      }
    },
  })

  const goalsRead = defineTool({
    name: 'goal.list',
    description:
      'List the company goals. Read these before prioritising anything — work that serves no ' +
      'stated goal is worth flagging rather than doing.',
    risk: 'read',
    permission: 'goal:read',
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const goals = await context.prisma.goal.findMany({
        where: { workspaceId: context.workspaceId, status: 'active' },
        orderBy: { targetDate: 'asc' },
        select: {
          id: true,
          title: true,
          description: true,
          horizon: true,
          ownerKey: true,
          targetDate: true,
        },
      })

      return {
        count: goals.length,
        goals: goals.map((goal) => ({
          ...goal,
          targetDate: goal.targetDate?.toISOString().slice(0, 10) ?? null,
        })),
      }
    },
  })

  const reportGenerate = defineTool({
    name: 'report.generate',
    description:
      'File a report for the CEO. Use this for anything worth reading later; it is stored and ' +
      'also written into long-term memory.',
    risk: 'internal',
    permission: 'report:create',
    inputSchema: z.object({
      kind: z.enum([
        'daily_brief',
        'weekly_review',
        'research',
        'campaign',
        'financial',
        'incident',
        'custom',
      ]),
      title: z.string().min(3).max(200),
      body: z.string().min(20).describe('Markdown. Lead with what changed, not with process.'),
      highlights: z.array(z.string()).max(8).optional(),
    }),
    execute: async (input, context) => {
      const report = await context.prisma.report.create({
        data: {
          workspaceId: context.workspaceId,
          departmentId: context.actor.id,
          runId: context.runId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          ...(input.highlights === undefined ? {} : { highlights: input.highlights }),
        },
        select: { id: true },
      })

      // A report nobody can search for later is a report that may as well not
      // exist, so it goes into memory as well as the reports table.
      await ingest({
        prisma: context.prisma,
        router,
        workspaceId: context.workspaceId,
        departmentId: context.actor.id,
        kind: 'report',
        title: input.title,
        content: input.body,
        scopes,
        sourceRef: `report:${report.id}`,
      })

      return { reportId: report.id, title: input.title }
    },
  })

  return [
    memoryRecall,
    memoryWrite,
    taskCreate,
    taskUpdate,
    listTasks,
    goalsRead,
    reportGenerate,
  ] as NexusTool<z.ZodType>[]
}

/**
 * Every tool the system has.
 *
 * The registry is built identically for all nine departments and the *allowlist*
 * decides what each one sees — a department is never handed a registry that
 * happens to be missing a dangerous tool, because "it wasn't registered" is not
 * an access control. `toolsFor` throws on a name it does not know, so a typo in a
 * charter fails loudly at startup instead of silently removing a capability.
 */
export function createRegistry(options: BuiltinToolOptions): ToolRegistry {
  return new ToolRegistry().register(
    ...createBuiltinTools(options),
    ...createOperationsTools(),
    ...createResearchTools({ router: options.router }),
    ...createMarketingTools(),
    ...createSalesTools(),
    ...createFinanceTools(),
    ...createSupportTools(),
    ...createEngineeringTools(),
    ...createAssistantTools(),
  )
}

/**
 * The default allowlist for a department that has not been configured.
 *
 * Platform tools only, and it is the same constant the seed composes from — so a
 * misconfigured department degrades to "can think, cannot touch the outside
 * world" rather than inheriting whatever happened to be registered.
 */
export const DEFAULT_TOOLS = PLATFORM_TOOLS
