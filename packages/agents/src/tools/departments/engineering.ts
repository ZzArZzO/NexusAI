import { z } from 'zod'

import { defineTool, type NexusTool } from '../registry'

/**
 * Engineering tools.
 *
 * Reviewing is `internal` — a draft review is just an opinion in a table.
 * Posting is `external`, because a review comment appears on a public pull
 * request under the operator's account.
 *
 * There is deliberately no tool here that reads source code. Doing that honestly
 * needs the GitHub connector; a tool that pretended to read a repository would
 * produce reviews of code it never saw, which is worse than having no tool.
 */
export function createEngineeringTools(): NexusTool<z.ZodType>[] {
  const registerRepository = defineTool({
    name: 'repo.register',
    description:
      'Register a repository so reviews and incidents can be attached to it. Use owner/name.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/name.'),
      provider: z.enum(['github', 'gitlab']).default('github'),
      defaultBranch: z.string().max(100).default('main'),
      localPath: z.string().max(400).optional().describe('If it is checked out on this machine.'),
    }),
    execute: async (input, context) => {
      const repository = await context.prisma.repository.upsert({
        where: {
          workspaceId_fullName: { workspaceId: context.workspaceId, fullName: input.fullName },
        },
        update: {
          provider: input.provider,
          defaultBranch: input.defaultBranch,
          ...(input.localPath === undefined ? {} : { localPath: input.localPath }),
        },
        create: {
          workspaceId: context.workspaceId,
          fullName: input.fullName,
          provider: input.provider,
          defaultBranch: input.defaultBranch,
          ...(input.localPath === undefined ? {} : { localPath: input.localPath }),
        },
        select: { id: true, fullName: true },
      })

      return { repositoryId: repository.id, fullName: repository.fullName }
    },
  })

  const listRepositories = defineTool({
    name: 'repo.list',
    description:
      'List registered repositories and their recent reviews. Note what you can and cannot see: ' +
      'no code host is connected, so this is the registry, not the code.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const repositories = await context.prisma.repository.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          fullName: true,
          provider: true,
          defaultBranch: true,
          localPath: true,
          _count: { select: { reviews: true } },
        },
      })

      return {
        count: repositories.length,
        repositories: repositories.map((repository) => ({
          id: repository.id,
          fullName: repository.fullName,
          provider: repository.provider,
          defaultBranch: repository.defaultBranch,
          checkedOutLocally: repository.localPath !== null,
          reviews: repository._count.reviews,
        })),
      }
    },
  })

  const draftReview = defineTool({
    name: 'review.draft',
    description:
      'Draft a pull request review. Every finding needs a file, a severity and a concrete fix — ' +
      '"consider refactoring" is not a finding. If you have not seen the diff, say so and stop.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      repositoryId: z.uuid(),
      number: z.number().int().positive(),
      title: z.string().min(3).max(300),
      body: z.string().min(20).describe('Markdown. Lead with the verdict and why.'),
      verdict: z.enum(['approve', 'request_changes', 'comment']),
      findings: z
        .array(
          z.object({
            file: z.string().min(1).max(400),
            line: z.number().int().positive().optional(),
            severity: z.enum(['critical', 'high', 'medium', 'low']),
            issue: z.string().min(10).max(500),
            fix: z.string().min(10).max(500),
          }),
        )
        .max(30)
        .default([]),
    }),
    execute: async (input, context) => {
      const repository = await context.prisma.repository.findFirst({
        where: { id: input.repositoryId, workspaceId: context.workspaceId },
        select: { id: true },
      })

      if (!repository) return { status: 'not_found' as const }

      const review = await context.prisma.pullRequestReview.create({
        data: {
          repositoryId: input.repositoryId,
          number: input.number,
          title: input.title,
          body: input.body,
          verdict: input.verdict,
          findings: input.findings,
          ...(context.runId === undefined ? {} : { runId: context.runId }),
        },
        select: { id: true },
      })

      const blocking = input.findings.filter(
        (finding) => finding.severity === 'critical' || finding.severity === 'high',
      ).length

      return {
        reviewId: review.id,
        verdict: input.verdict,
        findings: input.findings.length,
        blocking,
        note: 'Drafted only. Nothing is posted until the operator approves it.',
      }
    },
  })

  const postReview = defineTool({
    name: 'review.post',
    description:
      'Request permission to post a drafted review to the pull request. This does NOT post it.',
    risk: 'external',
    permission: 'task:update',
    inputSchema: z.object({ reviewId: z.uuid() }),
    describe: () => ({
      title: 'Post a code review to a pull request',
      summary:
        'Engineering has drafted a review. Read it first — it appears publicly on the pull ' +
        'request under your account.',
    }),
    execute: async (input, context) => {
      await context.prisma.pullRequestReview.update({
        where: { id: input.reviewId },
        data: { postedAt: new Date() },
      })

      return {
        reviewId: input.reviewId,
        note: 'Approved and marked posted. No code host is connected, so nothing has been published.',
      }
    },
  })

  const recordIncident = defineTool({
    name: 'incident.record',
    description:
      'Open an incident. Record when it started, not when you noticed — the gap is usually the ' +
      'most useful number in the postmortem.',
    risk: 'internal',
    permission: 'task:create',
    inputSchema: z.object({
      title: z.string().min(5).max(200),
      severity: z.enum(['critical', 'major', 'minor']),
      summary: z.string().min(10).max(2000),
      startedAt: z.string().datetime().optional().describe('Defaults to now.'),
    }),
    execute: async (input, context) => {
      const incident = await context.prisma.incident.create({
        data: {
          workspaceId: context.workspaceId,
          title: input.title,
          severity: input.severity,
          summary: input.summary,
          status: 'investigating',
          startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
        },
        select: { id: true },
      })

      // Critical incidents interrupt; the rest wait to be read. An alert that
      // fires for everything trains the operator to ignore it.
      if (input.severity === 'critical') {
        await context.prisma.notification.create({
          data: {
            workspaceId: context.workspaceId,
            level: 'critical',
            title: `Critical incident: ${input.title}`,
            body: input.summary,
            href: '/departments/engineering',
          },
        })
      }

      return { incidentId: incident.id, status: 'investigating' as const }
    },
  })

  const updateIncident = defineTool({
    name: 'incident.update',
    description:
      'Move an incident along. Only claim a root cause when you can point at the change that ' +
      'caused it — "increased load" is a symptom. Resolving without one is allowed; say it is unknown.',
    risk: 'internal',
    permission: 'task:update',
    inputSchema: z.object({
      incidentId: z.uuid(),
      status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
      rootCause: z.string().min(15).max(2000).optional(),
      summary: z.string().max(2000).optional(),
    }),
    execute: async (input, context) => {
      const existing = await context.prisma.incident.findFirst({
        where: { id: input.incidentId, workspaceId: context.workspaceId },
        select: { id: true, rootCause: true },
      })

      if (!existing) return { status: 'not_found' as const }

      const incident = await context.prisma.incident.update({
        where: { id: input.incidentId },
        data: {
          status: input.status,
          ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          ...(input.status === 'resolved' ? { resolvedAt: new Date() } : {}),
        },
        select: { id: true, status: true, rootCause: true },
      })

      return {
        incidentId: incident.id,
        status: incident.status,
        // Surfaced so the model can see that it resolved something it never
        // explained, rather than the fact quietly disappearing.
        rootCauseKnown: incident.rootCause !== null,
      }
    },
  })

  const listIncidents = defineTool({
    name: 'incident.list',
    description:
      'List incidents. Read this before saying the system is healthy, and look for repeats — the ' +
      'same failure three times is a design problem, not three incidents.',
    risk: 'read',
    permission: 'task:read',
    inputSchema: z.object({
      openOnly: z.boolean().default(false),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    execute: async (input, context) => {
      const incidents = await context.prisma.incident.findMany({
        where: {
          workspaceId: context.workspaceId,
          ...(input.openOnly ? { status: { not: 'resolved' } } : {}),
        },
        orderBy: { startedAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          title: true,
          status: true,
          severity: true,
          rootCause: true,
          startedAt: true,
          resolvedAt: true,
        },
      })

      return {
        count: incidents.length,
        incidents: incidents.map((incident) => ({
          id: incident.id,
          title: incident.title,
          status: incident.status,
          severity: incident.severity,
          rootCauseKnown: incident.rootCause !== null,
          startedAt: incident.startedAt.toISOString(),
          /** Only meaningful once resolved; null while it is still burning. */
          minutesToResolve:
            incident.resolvedAt === null
              ? null
              : Math.round((incident.resolvedAt.getTime() - incident.startedAt.getTime()) / 60000),
        })),
      }
    },
  })

  return [
    registerRepository,
    listRepositories,
    draftReview,
    postReview,
    recordIncident,
    updateIncident,
    listIncidents,
  ] as NexusTool<z.ZodType>[]
}
