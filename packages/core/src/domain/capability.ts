/**
 * What an integration can do, as vocabulary rather than as provider names.
 *
 * This lives in `core` — not in `integrations` — because two layers need to agree
 * on it and neither may import the other: `integrations` declares which
 * capabilities each connector provides, and the department grants below decide who
 * may use them. Keeping the vocabulary in the package with no I/O is what lets
 * both sides reference the same strings.
 *
 * Capabilities are also what makes "connect Slack" a decision about *ability*
 * rather than about a vendor. A department granted `chat.send` can post to
 * whatever chat provider is connected, and swapping Slack for Discord grants
 * nothing new.
 */
export const CAPABILITIES = [
  'email.read',
  'email.send',
  'calendar.read',
  'calendar.write',
  'files.read',
  'files.write',
  'repo.read',
  'repo.write',
  'chat.read',
  'chat.send',
  'social.read',
  'social.publish',
  'payments.read',
  'payments.write',
  'docs.read',
  'docs.write',
  'crm.read',
  'crm.write',
  /** An MCP server contributes tools that cannot be enumerated ahead of time. */
  'mcp.tools',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value)
}
