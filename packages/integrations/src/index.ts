export {
  AUTH_KINDS,
  CAPABILITIES,
  connectionConfigSchema,
  defineConnector,
  type AuthKind,
  type Capability,
  type Connector,
  type ConnectorTool,
  type ConnectorToolRisk,
  type HealthStatus,
  type WebhookRequest,
  type WebhookVerification,
} from './connector'

export { ConnectorRegistry } from './registry'
export { createConnectorRegistry } from './connectors/index'

export {
  checkHealth,
  connect,
  disconnect,
  grantedCapabilities,
  keyRing,
  listConnections,
  rekeyAll,
  resetKeyRing,
  withClient,
  CredentialExpiredError,
  NotConnectedError,
  type ConnectionSummary,
} from './connections'

export {
  CredentialCryptoError,
  keyRingFromEnv,
  needsRotation,
  open,
  safeEqual,
  seal,
  type KeyRing,
  type SealedCredential,
} from './crypto'

export { HttpError, request, type RequestOptions } from './http'

export {
  markProcessed,
  pendingEvents,
  receive,
  verifyHmac,
  withinTolerance,
  type ReceiveResult,
} from './webhook'
