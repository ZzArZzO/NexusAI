import { CAPABILITIES, type Capability } from '@nexusai/core'
import { z } from 'zod'

export { CAPABILITIES, type Capability }

/**
 * The connector contract.
 *
 * One interface, N implementations. Adding Slack means one folder and one
 * registry entry — nothing else in the system changes, and its tools appear
 * automatically to the departments granted its capabilities.
 *
 * Two design decisions are load-bearing:
 *
 *  1. **A connector declares tools; it does not execute them itself.** `tools()`
 *     returns descriptors that `@nexusai/agents` turns into gated tools. That is
 *     why a connector cannot bypass the approval gate: it never owns an
 *     `execute` path that the gate does not wrap.
 *
 *  2. **Capabilities are strings, granted per connection.** OAuth commonly grants
 *     less than was asked for, so what a connection can actually do is recorded
 *     after connecting, not assumed from the connector definition.
 */

export const AUTH_KINDS = ['oauth2', 'apikey', 'basic', 'none'] as const
export type AuthKind = (typeof AUTH_KINDS)[number]

/**
 * Risk tier of a connector-contributed tool.
 *
 * Mirrors `RiskTier` in `@nexusai/core` deliberately rather than importing it:
 * a connector author declaring `external` should be stating a fact about their
 * tool, and the agents layer maps it onto the gate. Keeping the string identical
 * means the mapping is an identity function and cannot drift.
 */
export type ConnectorToolRisk = 'read' | 'internal' | 'external' | 'financial'

export interface ConnectorTool {
  /** Fully qualified: `gmail.send`, `github.pr.comment`. */
  name: string
  description: string
  risk: ConnectorToolRisk
  capability: Capability
  inputSchema: z.ZodType
  /** What approving this would do, in the operator's terms. */
  describe?: (input: unknown) => { title: string; summary: string }
  /**
   * The client arrives as an argument rather than being captured in a closure.
   *
   * That is what lets `tools()` be declared without a connection: the agent tool
   * registry is assembled from static descriptors, and a client is built only when
   * a tool actually runs. Otherwise every agent invocation would refresh Google's
   * OAuth token and round-trip to every connected provider before doing anything.
   */
  execute: (input: unknown, client: unknown) => Promise<unknown>
}

export type HealthStatus =
  { ok: true; detail?: string } | { ok: false; reason: string; reauthorize: boolean }

export interface WebhookVerification {
  /** The provider's own event id, for deduplication. */
  externalId: string
  eventType: string
  /** False means the signature did not verify. The event is stored and ignored. */
  signatureOk: boolean
}

export interface WebhookRequest {
  headers: Readonly<Record<string, string>>
  /** The exact bytes received. Signatures are computed over the raw body — a
   *  parsed-and-restringified body will not verify. */
  rawBody: string
}

export interface Connector<TCredential = unknown, TClient = unknown> {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly auth: AuthKind
  /** OAuth scopes or the equivalent, requested at connect time. */
  readonly scopes: readonly string[]
  readonly capabilities: readonly Capability[]
  /** Zod schema for the credential this connector stores, validated before sealing. */
  readonly credentialSchema: z.ZodType<TCredential>
  /** Non-secret settings, e.g. a default repository or a from-address. */
  readonly configSchema?: z.ZodType

  connect(credential: TCredential, config?: unknown): Promise<TClient>
  /**
   * The tools this connector always provides.
   *
   * Synchronous and client-free, so the registry can be built offline. Anything
   * that must be asked of a live endpoint goes in `discoverTools`.
   */
  tools(): ConnectorTool[]
  /**
   * Tools that only exist once connected — an MCP server's `tools/list`.
   *
   * Separate from `tools()` so the expensive, network-dependent case is opt-in and
   * visible, rather than every connector paying for the one that needs it.
   */
  discoverTools?(client: TClient): Promise<ConnectorTool[]>
  healthCheck(client: TClient): Promise<HealthStatus>

  /**
   * Verify an inbound webhook. Absent means the connector has no webhooks.
   *
   * Returning `signatureOk: false` rather than throwing is deliberate: an
   * unverified event is evidence — possibly of someone probing the endpoint — and
   * discarding it silently would erase that.
   */
  verifyWebhook?(request: WebhookRequest, secret: string): WebhookVerification
}

/**
 * A connector with its credential and client types erased.
 *
 * The registry holds connectors of every shape at once, so it needs one type they
 * all satisfy. That cannot be spelled `Connector<never, never>`, because the type
 * parameters appear in both directions: `never` works where a value flows *in*
 * (parameters are contravariant, and every type accepts a `never` argument) but
 * fails where one flows *out* — `Promise<Client>` is not `Promise<never>`.
 *
 * So it is written out with the variance handled per position: `never` going in,
 * `unknown` coming out. Doing that here means no call site needs a cast, and a
 * connector that does not fit is a compile error at its own definition.
 */
export interface AnyConnector {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly auth: AuthKind
  readonly scopes: readonly string[]
  readonly capabilities: readonly Capability[]
  readonly credentialSchema: z.ZodType
  readonly configSchema?: z.ZodType | undefined
  connect(credential: never, config?: unknown): Promise<unknown>
  tools(): ConnectorTool[]
  discoverTools?(client: never): Promise<ConnectorTool[]>
  healthCheck(client: never): Promise<HealthStatus>
  verifyWebhook?(request: WebhookRequest, secret: string): WebhookVerification
}

/**
 * Declare a connector.
 *
 * Thin on purpose. The value is not in what this function does but in the fact
 * that every connector goes through it, so a new provider cannot quietly invent
 * its own shape.
 */
export function defineConnector<TCredential, TClient>(
  connector: Connector<TCredential, TClient>,
): Connector<TCredential, TClient> {
  if (connector.capabilities.length === 0) {
    throw new Error(`Connector "${connector.id}" declares no capabilities, so nothing can use it.`)
  }

  if (connector.auth !== 'none' && connector.scopes.length === 0 && connector.auth === 'oauth2') {
    throw new Error(`Connector "${connector.id}" uses OAuth but requests no scopes.`)
  }

  return connector
}

/** The shape stored in `integration_connection.config`. */
export const connectionConfigSchema = z.record(z.string(), z.unknown())
