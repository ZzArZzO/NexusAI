export {
  AutomationPausedError,
  DepartmentAgent,
  type AgentOptions,
  type DepartmentSpec,
} from './kernel/agent'
export { loadAgent, parseDuration, type LoadAgentParams } from './kernel/load'

export {
  createMockEmbeddingModel,
  createMockLanguageModel,
  deterministicVector,
} from './models/mock'
export { costMicros, formatMicros, PRICES, type TokenUsage } from './models/pricing'
export {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  MODEL_ROLES,
  ModelRouter,
  PROFILES,
  routerFromEnv,
  type ModelProfile,
  type ModelRole,
  type ResolvedModel,
} from './models/router'

export {
  createBuiltinTools,
  createRegistry,
  DEFAULT_TOOLS,
  type BuiltinToolOptions,
} from './tools/builtin'
export {
  defineTool,
  ToolRegistry,
  type AwaitingApproval,
  type NexusTool,
  type ToolContext,
  type ToolDefinition,
} from './tools/registry'

export {
  backfillEmbeddings,
  chunkDocument,
  embeddableText,
  estimateTokens,
  hashContent,
  ingest,
  recall,
  renderForPrompt,
  type BackfillResult,
  type Chunk,
  type ChunkOptions,
  type IngestParams,
  type IngestResult,
  type RecallParams,
} from './memory/index'
