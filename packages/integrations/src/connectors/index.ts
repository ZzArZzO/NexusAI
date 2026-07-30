import { ConnectorRegistry } from '../registry'
import { github } from './github'
import { google } from './google'
import { mcp } from './mcp'
import { notion } from './notion'
import { slack } from './slack'
import { stripe } from './stripe'

export { github, google, mcp, notion, slack, stripe }

/**
 * Every connector this build knows about.
 *
 * Six, chosen because between them they cover the capability classes the
 * departments actually need — mail and calendar (Assistant, Sales, Support), code
 * (Engineering), money (Finance), chat (Operations), documents (everyone) — and
 * because MCP makes the rest additive without touching this file's neighbours.
 *
 * The registry holds definitions, not connections. Registering a connector grants
 * nothing: until the operator connects it there is no credential, and every tool
 * it contributes is unreachable.
 */
export function createConnectorRegistry(): ConnectorRegistry {
  return new ConnectorRegistry().register(github, google, slack, stripe, notion, mcp)
}
