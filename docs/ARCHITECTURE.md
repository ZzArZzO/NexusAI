# Architecture

NexusAI is a single-operator AI operating system: nine departments, each an
agent, sharing one long-term memory, delegating to each other, and executing
real actions under human supervision.

Four problems shape every decision below.

1. **Durable orchestration** — workflows run for hours and must survive process
   restarts without re-sending an email.
2. **One shared memory** — nine agents, one substrate, retrievable by both
   meaning and exact term.
3. **Safe autonomy** — an agent may act on the outside world only through a gate
   it cannot argue its way past.
4. **Modular integrations** — 20+ external services, added without rewrites.

## Layers

```
┌─ Presentation ── apps/web            Next.js App Router · RSC · shadcn/ui · Motion
├─ API ─────────── route handlers      + server actions, all behind the Policy layer
├─ Orchestration ─ Inngest             durable steps · fan-out · approval gates
├─ Agent kernel ── packages/agents     DepartmentAgent · ToolRegistry · ModelRouter
├─ Domain ──────── packages/core       pure logic, no workspace dependencies
├─ Integrations ── packages/integrations   one connector per provider
└─ Data ────────── packages/db         Prisma 7 · Postgres · pgvector
```

Dependencies point downward only. That is enforced, not merely documented:
`layerBoundaries()` in `packages/config/eslint/base.js` turns an upward import
into a lint error.

## The agent kernel

One class, nine configurations. A department differs only in its charter prompt,
tool allowlist, model roles, memory scopes and delegation edges.

```ts
interface DepartmentSpec {
  id: DepartmentId
  displayName: string
  charter: string
  tools: ToolName[]
  models: Partial<Record<ModelRole, ModelId>>
  memoryScopes: MemoryScope[]
  canDelegateTo: DepartmentId[]
  maxSteps: number
}
```

The org chart itself lives in `packages/core/src/domain/department.ts`, and a
test asserts the delegation graph is acyclic — two departments cannot hand work
back and forth forever.

Two execution modes share the kernel:

- **Interactive** — `streamText` in a route handler; tokens and tool calls
  stream to the user.
- **Autonomous** — the same agent invoked inside an Inngest step. Each tool call
  is its own `step.run`, independently retried and memoised. A crash resumes at
  the last completed step.

**ModelRouter** maps logical roles to concrete models, so no department hardcodes
a provider:

| Role        | Model                    | Used for                                   |
| ----------- | ------------------------ | ------------------------------------------ |
| `reasoning` | `claude-opus-5`          | CEO planning, architecture, judgment       |
| `drafting`  | `claude-sonnet-5`        | Marketing copy, support replies, code      |
| `bulk`      | `claude-haiku-4-5`       | Classification, extraction, summarise-many |
| `embedding` | `text-embedding-3-small` | Memory chunks (1536d)                      |

## Risk tiers — the safety spine

Every tool declares a tier. The tier, not the agent, decides whether execution
pauses. See `packages/core/src/domain/risk.ts`.

| Tier        | Meaning                         | Behaviour                          |
| ----------- | ------------------------------- | ---------------------------------- |
| `read`      | Fetch, search, analyse          | Runs immediately                   |
| `internal`  | Writes only to our own database | Runs immediately, audit-logged     |
| `external`  | Email, post, message, push code | **Approval gate**                  |
| `financial` | Moves money or commits spend    | **Approval gate + second confirm** |

```ts
const approval = await step.waitForEvent('await-approval', {
  event: 'nexus/approval.responded',
  match: 'data.approvalId',
  timeout: '72h',
})
if (!approval?.data.approved) return { status: 'rejected' }
```

A timeout yields `null`, which means the action never happens. Fail-closed by
construction, plus a global PAUSE switch (`automation.paused` in
`system_setting`) checked at the head of every workflow.

## Long-term memory

One shared substrate, namespaced by scope — not nine private memories.

| Table             | Holds                                                         |
| ----------------- | ------------------------------------------------------------- |
| `memory_document` | Canonical source: note, meeting, report, conversation summary |
| `memory_chunk`    | Chunk text + `vector(1536)` + generated `tsvector` + metadata |
| `memory_link`     | Typed edges: document ↔ project / person / department / task  |
| `memory_fact`     | Durable atomic facts distilled from recurring signals         |

Retrieval is **hybrid**: full-text and semantic results fused by Reciprocal Rank
Fusion inside one Postgres function. Semantic search alone misses exact names;
keyword search alone misses paraphrase. Index: `USING hnsw (embedding
vector_cosine_ops)`.

Vectors live in the same database as the relational rows, which is the whole
argument for pgvector over a separate vector store: writes are transactional,
so the two can never drift.

## Inter-department communication

Departments never call each other's functions directly. Two channels, both
durable and logged:

1. **Event bus** — `nexus/task.assigned`, `nexus/report.ready`. Fan-out.
2. **Delegation** — `step.invoke()` when the caller needs the result, bounded by
   `canDelegateTo`.

## Explainability

Three linked tables make every output traceable: `run` (one agent invocation),
`run_step` (ordered steps with tool calls and retrieved chunks), and an
append-only `audit_log`. Any answer in the UI links back to the run that
produced it, then to the memory it cited.

## Permissions

RBAC from day one so multi-user later is configuration, not surgery:
`workspace → membership → role → permission`, with permissions shaped as
`resource:action:scope`.

**Prisma connects with a privileged role, which bypasses Postgres RLS.** The
application `Policy` module is therefore the primary control; RLS is enabled on
every table as defence in depth for anything reaching Supabase directly
(Realtime, Storage, the client SDK). A test asserts the two agree.

## Integrations

```ts
interface Connector<TConfig, TClient> {
  id: string
  auth: 'oauth2' | 'apikey' | 'none'
  scopes: string[]
  capabilities: Capability[]
  connect(cred: Credential): Promise<TClient>
  tools(client: TClient): ToolDefinition[]
  healthCheck(client: TClient): Promise<HealthStatus>
}
```

Adding Slack is one folder plus a registry entry; its tools appear automatically
to departments granted its capabilities. Credentials are envelope-encrypted at
rest (AES-256-GCM), never logged, never returned to the client.

MCP servers are a connector type, so MCP tools flow through the identical risk
tier and audit path as native ones.

## Related

- [Roadmap and phase plan](../README.md)
- [Raw SQL: what lives outside Prisma](../infra/sql/README.md)
- [ADR 0001: foundation stack](ADR/0001-foundation-stack.md)
