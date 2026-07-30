import { canDelegate, departmentIdSchema } from '@nexusai/core'
import { z } from 'zod'

import { defineTool, type NexusTool } from '../registry'

/**
 * Operations tools.
 *
 * Operations does not do the work; it decides what happens in which order and
 * notices when something has stopped. So its tools are all `read` or `internal` —
 * an orchestrator that could also send emails would be a second CEO.
 *
 * `dependency.add` is the one that needs care: a cycle in the dependency graph
 * deadlocks the board forever and nothing in the schema prevents it, so the tool
 * walks the graph before writing.
 */
export function createOperationsTools(): NexusTool<z.ZodType>[] {
  const assignTask = defineTool({
    name: 'task.assign',
    description:
      'Hand an existing task to a department. Only within the org chart — if the edge is not ' +
      'yours, route it through the CEO rather than around them.',
    risk: 'internal',
    permission: 'task:update',
    inputSchema: z.object({
      taskId: z.uuid(),
      department: departmentIdSchema,
      note: z.string().max(500).optional().describe('Why them, in one line.'),
    }),
    execute: async (input, context) => {
      if (!canDelegate(context.actor.key, input.department)) {
        return {
          status: 'refused' as const,
          reason: `${context.actor.key} may not delegate to ${input.department}.`,
        }
      }

      const [task, target] = await Promise.all([
        context.prisma.task.findFirst({
          where: { id: input.taskId, workspaceId: context.workspaceId },
          select: { id: true, title: true },
        }),
        context.prisma.department.findUnique({
          where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.department } },
          select: { id: true },
        }),
      ])

      if (!task || !target) return { status: 'not_found' as const }

      await context.prisma.task.update({
        where: { id: input.taskId },
        data: { departmentId: target.id },
      })

      await context.prisma.taskEvent.create({
        data: {
          taskId: input.taskId,
          kind: 'reassigned',
          actor: context.actor.key,
          detail: {
            to: input.department,
            ...(input.note === undefined ? {} : { note: input.note }),
          },
        },
      })

      return { taskId: input.taskId, assignedTo: input.department }
    },
  })

  const addDependency = defineTool({
    name: 'dependency.add',
    description:
      'Declare that one task cannot start until another finishes. Use this instead of describing ' +
      'an order in prose — the board only respects what is recorded.',
    risk: 'internal',
    permission: 'task:update',
    inputSchema: z.object({
      taskId: z.uuid().describe('The task that must wait.'),
      blockedByTaskId: z.uuid().describe('The task it waits for.'),
    }),
    execute: async (input, context) => {
      if (input.taskId === input.blockedByTaskId) {
        return { status: 'refused' as const, reason: 'A task cannot block itself.' }
      }

      const tasks = await context.prisma.task.findMany({
        where: {
          id: { in: [input.taskId, input.blockedByTaskId] },
          workspaceId: context.workspaceId,
        },
        select: { id: true },
      })

      if (tasks.length !== 2) return { status: 'not_found' as const }

      /**
       * Would this edge close a cycle? Walk forward from the blocker: if the
       * waiting task is already somewhere upstream of it, adding this edge means
       * both tasks wait for each other and neither ever becomes actionable.
       */
      const seen = new Set<string>()
      let frontier = [input.blockedByTaskId]

      while (frontier.length > 0) {
        const edges = await context.prisma.taskDependency.findMany({
          where: { taskId: { in: frontier } },
          select: { blockedByTaskId: true },
        })

        const next: string[] = []
        for (const edge of edges) {
          if (edge.blockedByTaskId === input.taskId) {
            return {
              status: 'refused' as const,
              reason:
                'That would create a dependency cycle — the two tasks would each wait for the ' +
                'other and neither would ever start.',
            }
          }
          if (!seen.has(edge.blockedByTaskId)) {
            seen.add(edge.blockedByTaskId)
            next.push(edge.blockedByTaskId)
          }
        }

        frontier = next
      }

      await context.prisma.taskDependency.upsert({
        where: {
          taskId_blockedByTaskId: {
            taskId: input.taskId,
            blockedByTaskId: input.blockedByTaskId,
          },
        },
        update: {},
        create: { taskId: input.taskId, blockedByTaskId: input.blockedByTaskId },
      })

      return { taskId: input.taskId, blockedBy: input.blockedByTaskId }
    },
  })

  const companyStatus = defineTool({
    name: 'company.status',
    description:
      'Read the state of the whole company: runs, failures, approvals waiting, tasks stuck. ' +
      'Read this before planning anything. Report what is blocked before what is progressing.',
    risk: 'read',
    permission: 'run:read',
    inputSchema: z.object({ hours: z.number().int().min(1).max(168).default(24) }),
    execute: async (input, context) => {
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000)

      const [runs, pendingApprovals, blockedTasks, staleRuns, departments] = await Promise.all([
        context.prisma.run.groupBy({
          by: ['status'],
          where: { workspaceId: context.workspaceId, startedAt: { gte: since } },
          _count: true,
          _sum: { costMicros: true },
        }),
        context.prisma.approvalRequest.findMany({
          where: { workspaceId: context.workspaceId, status: 'pending' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, title: true, risk: true, expiresAt: true },
        }),
        context.prisma.task.count({
          where: { workspaceId: context.workspaceId, status: 'blocked' },
        }),
        // Running for over an hour is not "in progress"; something is wedged.
        context.prisma.run.findMany({
          where: {
            workspaceId: context.workspaceId,
            status: 'running',
            startedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
          },
          select: { id: true, objective: true, department: { select: { key: true } } },
        }),
        context.prisma.department.findMany({
          where: { workspaceId: context.workspaceId },
          select: { key: true, enabled: true },
        }),
      ])

      const total = runs.reduce((sum, row) => sum + row._count, 0)
      const failed = runs.find((row) => row.status === 'failed')?._count ?? 0

      return {
        windowHours: input.hours,
        runs: {
          total,
          failed,
          byStatus: Object.fromEntries(runs.map((r) => [r.status, r._count])),
        },
        // Dollars, from micro-dollars. Reported because an orchestrator that
        // cannot see cost will happily schedule the company into a large bill.
        costUsd: runs.reduce((sum, row) => sum + (row._sum.costMicros ?? 0), 0) / 1_000_000,
        approvalsWaiting: pendingApprovals.map((approval) => ({
          id: approval.id,
          title: approval.title,
          risk: approval.risk,
          expiresAt: approval.expiresAt?.toISOString() ?? null,
        })),
        blockedTasks,
        /** Started over an hour ago and never finished. Investigate before scheduling more. */
        stuckRuns: staleRuns.map((run) => ({
          id: run.id,
          department: run.department.key,
          objective: run.objective,
        })),
        disabledDepartments: departments.filter((d) => !d.enabled).map((d) => d.key),
      }
    },
  })

  const departmentWorkload = defineTool({
    name: 'department.workload',
    description:
      'What each department currently owns. Use it to spread work rather than piling it on ' +
      'whoever answered last.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const grouped = await context.prisma.task.groupBy({
        by: ['departmentId', 'status'],
        where: {
          workspaceId: context.workspaceId,
          status: { notIn: ['done', 'cancelled'] },
        },
        _count: true,
      })

      const departments = await context.prisma.department.findMany({
        where: { workspaceId: context.workspaceId },
        select: { id: true, key: true },
      })

      return {
        workload: departments.map((department) => {
          const rows = grouped.filter((row) => row.departmentId === department.id)
          return {
            department: department.key,
            open: rows.reduce((sum, row) => sum + row._count, 0),
            byStatus: Object.fromEntries(rows.map((row) => [row.status, row._count])),
          }
        }),
        unassigned: grouped
          .filter((row) => row.departmentId === null)
          .reduce((sum, row) => sum + row._count, 0),
      }
    },
  })

  return [assignTask, addDependency, companyStatus, departmentWorkload] as NexusTool<z.ZodType>[]
}
