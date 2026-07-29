import type { PrismaClient } from '../client'
import { type Prisma } from '../../generated/client'

/**
 * Append-only audit trail.
 *
 * There is deliberately no update or delete here. If "what happened" can be
 * edited, it is not an audit log — so the only exported write is `record`.
 */

export interface AuditActor {
  /** A person acted. */
  userId?: string
  /** An agent acted. Exactly one of the two is set. */
  departmentId?: string
}

export interface RecordAuditParams extends AuditActor {
  workspaceId: string
  /** Verb, past tense: 'created', 'approved', 'published', 'deleted'. */
  action: string
  /** Dotted resource type: 'task', 'memory.document', 'approval'. */
  resource: string
  resourceId?: string
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
}

export async function record(prisma: PrismaClient, params: RecordAuditParams): Promise<void> {
  if (params.userId === undefined && params.departmentId === undefined) {
    throw new Error('An audit entry must name an actor: either userId or departmentId.')
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: params.workspaceId,
      action: params.action,
      resource: params.resource,
      ...(params.userId === undefined ? {} : { userId: params.userId }),
      ...(params.departmentId === undefined ? {} : { departmentId: params.departmentId }),
      ...(params.resourceId === undefined ? {} : { resourceId: params.resourceId }),
      ...(params.before === undefined ? {} : { before: params.before as Prisma.InputJsonValue }),
      ...(params.after === undefined ? {} : { after: params.after as Prisma.InputJsonValue }),
      ...(params.metadata === undefined
        ? {}
        : { metadata: params.metadata as Prisma.InputJsonValue }),
    },
  })
}

/** Everything that ever touched one resource, newest first. */
export async function findForResource(
  prisma: PrismaClient,
  params: { workspaceId: string; resource: string; resourceId: string; limit?: number },
) {
  return prisma.auditLog.findMany({
    where: {
      workspaceId: params.workspaceId,
      resource: params.resource,
      resourceId: params.resourceId,
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit ?? 50,
    include: {
      user: { select: { id: true, name: true } },
      department: { select: { key: true, displayName: true } },
    },
  })
}

export async function findRecent(
  prisma: PrismaClient,
  params: { workspaceId: string; limit?: number },
) {
  return prisma.auditLog.findMany({
    where: { workspaceId: params.workspaceId },
    orderBy: { createdAt: 'desc' },
    take: params.limit ?? 100,
    include: {
      user: { select: { id: true, name: true } },
      department: { select: { key: true, displayName: true } },
    },
  })
}
