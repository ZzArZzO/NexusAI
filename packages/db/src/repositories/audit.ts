import type { PrismaClient } from '../client'
import { type Prisma } from '../../generated/client'

/**
 * Append-only audit trail.
 *
 * There is deliberately no update or delete here. If "what happened" can be
 * edited, it is not an audit log — so the only exported write is `record`.
 */

/**
 * Who acted. Exactly one of the three, which is why this is a union rather than
 * three optional fields — "both set" and "none set" are not representable.
 */
export type AuditActor =
  /** A person. */
  | { userId: string }
  /** An agent. */
  | { departmentId: string }
  /** A named scheduled job. Named, because an anonymous change is the one audit
   *  entry nobody can ever explain. */
  | { system: string }

export interface RecordAuditParams {
  workspaceId: string
  actor: AuditActor
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
  const { actor } = params

  const attribution =
    'userId' in actor
      ? { userId: actor.userId }
      : 'departmentId' in actor
        ? { departmentId: actor.departmentId }
        : {}

  const systemMetadata = 'system' in actor ? { systemJob: actor.system } : {}

  await prisma.auditLog.create({
    data: {
      workspaceId: params.workspaceId,
      action: params.action,
      resource: params.resource,
      ...attribution,
      ...(params.resourceId === undefined ? {} : { resourceId: params.resourceId }),
      ...(params.before === undefined ? {} : { before: params.before as Prisma.InputJsonValue }),
      ...(params.after === undefined ? {} : { after: params.after as Prisma.InputJsonValue }),
      metadata: { ...systemMetadata, ...(params.metadata ?? {}) } as Prisma.InputJsonValue,
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
