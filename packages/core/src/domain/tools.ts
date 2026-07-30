import type { Capability } from './capability'
import type { DepartmentId } from './department'

/**
 * Which tools each department is granted.
 *
 * This is the org chart's counterpart: `canDelegateTo` says who a department may
 * ask, and this says what it may do itself. Both live here, in the package with
 * no I/O, for one reason — the seed in `@nexusai/db` and the registry in
 * `@nexusai/agents` must agree, and `agents` already depends on `db`, so a shared
 * constant cannot live in either of them without a cycle.
 *
 * The names are plain strings, deliberately not typed against the registry: the
 * registry is assembled at runtime and `toolsFor` throws on a name it does not
 * know, so a typo here fails loudly the first time that department runs rather
 * than silently costing it a capability. A test asserts both lists match.
 */

/** What every department has: memory, tasks, goals, reports. All read or internal. */
export const PLATFORM_TOOLS = [
  'memory.recall',
  'memory.write',
  'task.create',
  'task.update',
  'task.list',
  'goal.list',
  'report.generate',
] as const

/**
 * Remit-specific grants, on top of the platform set.
 *
 * The CEO's list is short on purpose. It reads the whole company and decides;
 * the tools that touch a domain belong to the department that owns it, so the CEO
 * cannot quietly do Marketing's job badly instead of delegating it.
 */
const SPECIFIC: Record<DepartmentId, readonly string[]> = {
  ceo: ['company.status', 'department.workload'],

  operations: ['task.assign', 'dependency.add', 'company.status', 'department.workload'],

  research: ['web.search', 'source.record', 'source.list'],

  marketing: [
    'content.create',
    'content.update',
    'content.list',
    'content.plan',
    'content.publish',
  ],

  sales: [
    'contact.upsert',
    'contact.score',
    'deal.upsert',
    'pipeline.read',
    'sequence.draft',
    'outreach.send',
    'activity.log',
  ],

  support: [
    'ticket.list',
    'ticket.read',
    'reply.draft',
    'reply.send',
    'ticket.escalate',
    'kb.write',
    'kb.search',
  ],

  finance: [
    'transaction.record',
    'ledger.read',
    'transaction.flag',
    'forecast.create',
    'subscription.track',
    'payment.send',
  ],

  engineering: [
    'repo.register',
    'repo.list',
    'review.draft',
    'review.post',
    'incident.record',
    'incident.update',
    'incident.list',
  ],

  assistant: [
    'agenda.read',
    'calendar.create',
    'calendar.block',
    'note.create',
    'reminder.create',
    'note.search',
  ],
}

/**
 * Web search is granted beyond Research.
 *
 * Marketing writing about a competitor and Finance sanity-checking a market rate
 * both need to look one thing up, and routing that through a delegation turns a
 * one-line question into a workflow. It is `read` tier, so nothing escapes.
 *
 * The two orchestrators are excluded. The CEO and Operations delegate research by
 * design, and a tool they hold is a tool they will eventually use instead of
 * asking the department whose job it is.
 */
const SHARED_READ: readonly string[] = ['web.search', 'source.record', 'source.list']
const ORCHESTRATORS: readonly DepartmentId[] = ['ceo', 'operations']

function grant(id: DepartmentId): readonly string[] {
  return [
    ...new Set([
      ...PLATFORM_TOOLS,
      ...SPECIFIC[id],
      ...(ORCHESTRATORS.includes(id) ? [] : SHARED_READ),
    ]),
  ]
}

/**
 * Written out key by key rather than derived from `DEPARTMENT_IDS`, so the
 * annotation makes it exhaustive: adding a tenth department fails to compile here
 * until someone decides what it may do, instead of defaulting it to something.
 */
export const DEPARTMENT_TOOLS: Readonly<Record<DepartmentId, readonly string[]>> = Object.freeze({
  ceo: grant('ceo'),
  operations: grant('operations'),
  research: grant('research'),
  marketing: grant('marketing'),
  sales: grant('sales'),
  support: grant('support'),
  finance: grant('finance'),
  engineering: grant('engineering'),
  assistant: grant('assistant'),
})

export function toolsForDepartment(id: DepartmentId): readonly string[] {
  return DEPARTMENT_TOOLS[id]
}

/**
 * Which integration capabilities each department may use.
 *
 * Connector tools cannot be granted by name, because the names depend on what the
 * operator has connected — and an MCP server's tool names are not knowable at all
 * until it answers. So the grant is by capability, and a connector tool reaches a
 * department only if its declared capability appears here.
 *
 * Two consequences worth stating:
 *
 *  - Connecting a provider grants nothing new by itself. Slack appearing does not
 *    give Finance the ability to post; Finance was never granted `chat.send`.
 *  - `mcp.tools` is granted to nobody. An MCP server's tools are unreviewed by
 *    construction, so reaching them is an explicit decision the operator makes per
 *    department, not a default.
 */
export const DEPARTMENT_CAPABILITIES: Readonly<Record<DepartmentId, readonly Capability[]>> =
  Object.freeze({
    /** Reads everything, sends nothing. The CEO decides; departments act. */
    ceo: ['email.read', 'calendar.read', 'payments.read', 'docs.read', 'repo.read'],

    /** Coordination needs a channel to say "this is blocked" in. */
    operations: ['chat.read', 'chat.send', 'docs.read'],

    research: ['docs.read', 'docs.write'],

    marketing: ['social.read', 'social.publish', 'docs.read', 'docs.write'],

    /** Sales owns outbound: mail, calendar for booking, and the CRM. */
    sales: ['email.read', 'email.send', 'calendar.read', 'calendar.write', 'crm.read', 'crm.write'],

    support: ['email.read', 'email.send', 'docs.read', 'docs.write'],

    /** Read-only on money by design; moving it is Finance's own gated tool. */
    finance: ['payments.read', 'docs.read'],

    engineering: ['repo.read', 'repo.write', 'chat.read', 'chat.send'],

    assistant: [
      'email.read',
      'email.send',
      'calendar.read',
      'calendar.write',
      'files.read',
      'files.write',
      'docs.read',
      'docs.write',
    ],
  })

export function capabilitiesForDepartment(id: DepartmentId): readonly Capability[] {
  return DEPARTMENT_CAPABILITIES[id]
}
