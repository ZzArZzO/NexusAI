import type { PrismaClient } from '../client'

/**
 * Tasks are the shared currency between departments: the CEO creates them,
 * departments pick them up, and delegation is visible because every task
 * records both who owns it and who created it.
 */

export type TaskStatus =
  'backlog' | 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'cancelled'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface CreateTaskParams {
  workspaceId: string
  title: string
  description?: string
  goalId?: string
  /** Department that will do the work. */
  departmentId?: string
  /** Department that asked for it, so delegation chains are readable. */
  createdByDepartmentId?: string
  runId?: string
  priority?: TaskPriority
  dueAt?: Date
  tags?: string[]
  /** 'user' or a department key — recorded on the opening task event. */
  actor: string
}

export async function createTask(prisma: PrismaClient, params: CreateTaskParams) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        workspaceId: params.workspaceId,
        title: params.title,
        priority: params.priority ?? 'medium',
        tags: params.tags ?? [],
        ...(params.description === undefined ? {} : { description: params.description }),
        ...(params.goalId === undefined ? {} : { goalId: params.goalId }),
        ...(params.departmentId === undefined ? {} : { departmentId: params.departmentId }),
        ...(params.createdByDepartmentId === undefined
          ? {}
          : { createdByDepartmentId: params.createdByDepartmentId }),
        ...(params.runId === undefined ? {} : { runId: params.runId }),
        ...(params.dueAt === undefined ? {} : { dueAt: params.dueAt }),
      },
    })

    await tx.taskEvent.create({
      data: { taskId: task.id, kind: 'created', actor: params.actor },
    })

    return task
  })
}

/**
 * Status changes write an event alongside the update, in one transaction, so the
 * task history can never disagree with the task.
 */
export async function updateTaskStatus(
  prisma: PrismaClient,
  params: { taskId: string; status: TaskStatus; actor: string; note?: string },
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.task.findUniqueOrThrow({
      where: { id: params.taskId },
      select: { status: true },
    })

    const task = await tx.task.update({
      where: { id: params.taskId },
      data: {
        status: params.status,
        ...(params.status === 'done' ? { completedAt: new Date() } : {}),
      },
    })

    await tx.taskEvent.create({
      data: {
        taskId: params.taskId,
        kind: 'status_changed',
        actor: params.actor,
        detail: {
          from: before.status,
          to: params.status,
          ...(params.note === undefined ? {} : { note: params.note }),
        },
      },
    })

    return task
  })
}

/**
 * Tasks ready to be worked: not done, and with every blocking dependency
 * already complete. The dependency check is why this is not a plain `findMany`.
 */
export async function findActionableTasks(
  prisma: PrismaClient,
  params: { workspaceId: string; departmentId?: string; limit?: number },
) {
  return prisma.task.findMany({
    where: {
      workspaceId: params.workspaceId,
      status: { in: ['todo', 'in_progress'] },
      ...(params.departmentId === undefined ? {} : { departmentId: params.departmentId }),
      dependsOn: { none: { blockedBy: { status: { notIn: ['done', 'cancelled'] } } } },
    },
    orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    take: params.limit ?? 50,
    include: {
      department: { select: { key: true, displayName: true } },
      goal: { select: { id: true, title: true } },
    },
  })
}

/** Everything due today or overdue — the dashboard's agenda panel. */
export async function findAgenda(
  prisma: PrismaClient,
  params: { workspaceId: string; before: Date },
) {
  return prisma.task.findMany({
    where: {
      workspaceId: params.workspaceId,
      status: { notIn: ['done', 'cancelled'] },
      dueAt: { lte: params.before },
    },
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
    include: { department: { select: { key: true, displayName: true } } },
  })
}

export async function countByStatus(prisma: PrismaClient, workspaceId: string) {
  const rows = await prisma.task.groupBy({
    by: ['status'],
    where: { workspaceId },
    _count: { _all: true },
  })

  return Object.fromEntries(rows.map((row) => [row.status, row._count._all])) as Partial<
    Record<TaskStatus, number>
  >
}
