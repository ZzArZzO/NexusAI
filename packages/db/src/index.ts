export { getPrisma, prisma, type PrismaClient } from './client'
export { Prisma } from '../generated/client'

export type {
  ApprovalRequest,
  ApprovalStatus,
  AuditLog,
  Conversation,
  Department,
  DepartmentConfig,
  DepartmentKey,
  Goal,
  Kpi,
  KpiSnapshot,
  MemoryChunk,
  MemoryDocument,
  MemoryFact,
  MemoryLink,
  Message,
  Notification,
  Report,
  RiskTier,
  Role,
  Run,
  RunStatus,
  RunStep,
  RunTrigger,
  SystemSetting,
  Task,
  TaskEvent,
  ToolCall,
  ToolCallStatus,
  User,
  Workspace,
} from '../generated/client'

export * as approvals from './repositories/approval'
export * as audit from './repositories/audit'
export * as memory from './repositories/memory'
export * as runs from './repositories/run'
export * as tasks from './repositories/task'
export * as workspaces from './repositories/workspace'

export { ApprovalExpiredError, ApprovalNotPendingError } from './repositories/approval'
export { EMBEDDING_DIMENSIONS, type RetrievedChunk } from './repositories/memory'
export { SETTING } from './repositories/workspace'
