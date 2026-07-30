import { runCampaign } from './functions/campaign'
import { delegateTask, runDepartment } from './functions/department'
import { awaitApproval, expireApprovals } from './functions/approvals'
import {
  backfillMemory,
  consolidateMemory,
  dailyBrief,
  ingestMemory,
  snapshotKpis,
} from './functions/schedule'

export { inngest, type NexusInngest } from './client'
export {
  ApprovalRequested,
  ApprovalResponded,
  CampaignRequested,
  DepartmentRun,
  EVENTS,
  MemoryIngest,
  ReportReady,
  RunFinished,
  TaskDelegated,
} from './events'
export { remainingBudgetMicros } from './functions/department'

/**
 * Every function the company runs.
 *
 * One array, exported once, consumed by the Next.js serve handler and the worker.
 * A function missing from here is a function Inngest never learns about — so it
 * would appear to work locally in tests and simply never fire in production.
 */
export const functions = [
  // Core execution
  runDepartment,
  delegateTask,

  // Gates
  awaitApproval,
  expireApprovals,

  // Cross-department
  runCampaign,

  // Scheduled
  dailyBrief,
  consolidateMemory,
  backfillMemory,
  snapshotKpis,
  ingestMemory,
]

export {
  awaitApproval,
  backfillMemory,
  consolidateMemory,
  dailyBrief,
  delegateTask,
  expireApprovals,
  ingestMemory,
  runCampaign,
  runDepartment,
  snapshotKpis,
}
