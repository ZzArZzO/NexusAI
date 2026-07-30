import { departmentIdSchema, riskTierSchema } from '@nexusai/core'
import { eventType } from 'inngest'
import { z } from 'zod'

/**
 * The event vocabulary.
 *
 * Departments never call each other's functions directly — they publish events
 * or delegate through `step.invoke`. Both are durable and both are logged, which
 * is what makes the org chart auditable rather than a diagram.
 *
 * Each event is an `eventType` carrying a Zod schema, so it serves as both the
 * trigger declaration and the constructor: `DepartmentRun.create({...})` is
 * type-checked and validated at the boundary rather than trusted.
 *
 * Every payload carries `workspaceId`. There is exactly one workspace today, but
 * a workflow that assumes so has to be rewritten rather than configured.
 */

const workspace = { workspaceId: z.uuid() }

/** Run a department agent. The workhorse — most other events end up sending this. */
export const DepartmentRun = eventType('nexus/department.run', {
  schema: z.object({
    ...workspace,
    department: departmentIdSchema,
    objective: z.string().min(3),
    /**
     * Required rather than defaulted. Inngest rejects a schema whose input and
     * output types differ, and a default on the wire is ambiguous anyway: the
     * reader cannot tell whether the sender meant it or the schema filled it in.
     */
    trigger: z.enum(['schedule', 'event', 'delegation', 'manual']),
    /** Set when one run delegated to another, forming the call tree. */
    parentRunId: z.uuid().optional(),
    conversationId: z.uuid().optional(),
  }),
})

/** A department asks another to do something outside its own remit. */
export const TaskDelegated = eventType('nexus/task.delegated', {
  schema: z.object({
    ...workspace,
    from: departmentIdSchema,
    to: departmentIdSchema,
    objective: z.string().min(3),
    parentRunId: z.uuid().optional(),
  }),
})

/** A department filed a report. */
export const ReportReady = eventType('nexus/report.ready', {
  schema: z.object({
    ...workspace,
    department: departmentIdSchema,
    reportId: z.uuid(),
    title: z.string(),
    kind: z.string(),
  }),
})

/**
 * The operator decided.
 *
 * This is what un-parks a gated workflow, and the reason waits match on
 * `approvalId` rather than on the run: one run can park several times, and each
 * gate has to resolve independently.
 */
export const ApprovalResponded = eventType('nexus/approval.responded', {
  schema: z.object({
    ...workspace,
    approvalId: z.uuid(),
    approved: z.boolean(),
    risk: riskTierSchema,
    /** Present for financial actions, which need a second, separate act. */
    secondConfirmed: z.boolean(),
  }),
})

/** A gated action is waiting. Drives the notification and the wait. */
export const ApprovalRequested = eventType('nexus/approval.requested', {
  schema: z.object({
    ...workspace,
    approvalId: z.uuid(),
    department: departmentIdSchema,
    risk: riskTierSchema,
    title: z.string(),
  }),
})

/** Something worth remembering happened. Ingested asynchronously. */
export const MemoryIngest = eventType('nexus/memory.ingest', {
  schema: z.object({
    ...workspace,
    kind: z.enum([
      'note',
      'document',
      'conversation',
      'meeting',
      'report',
      'research',
      'email',
      'web',
      'code',
    ]),
    title: z.string().min(1),
    content: z.string().min(1),
    scopes: z.array(z.string()).min(1),
    department: departmentIdSchema.optional(),
    sourceRef: z.string().optional(),
  }),
})

/** A piece of work that crosses several departments. */
export const CampaignRequested = eventType('nexus/campaign.requested', {
  schema: z.object({
    ...workspace,
    brief: z.string().min(10),
    /** Omit departments irrelevant to this campaign. */
    include: z.array(departmentIdSchema).optional(),
  }),
})

/** A run finished. Drives the activity feed and cost tracking. */
export const RunFinished = eventType('nexus/run.finished', {
  schema: z.object({
    ...workspace,
    runId: z.uuid(),
    department: departmentIdSchema,
    status: z.enum(['succeeded', 'failed', 'cancelled', 'awaiting_approval']),
    costMicros: z.number().int().min(0),
  }),
})

export const EVENTS = {
  DepartmentRun,
  TaskDelegated,
  ReportReady,
  ApprovalResponded,
  ApprovalRequested,
  MemoryIngest,
  CampaignRequested,
  RunFinished,
} as const
