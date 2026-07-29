# ADR 0001 — Foundation stack

**Status:** Accepted · 2026-07-29

## Context

NexusAI must run nine AI departments with shared memory, durable multi-hour
workflows, an approval layer, and modular integrations — built and operated by
one person. The stack has to be productive solo, but not paint us into a corner
when workflows get long or the data gets large.

## Decisions

### Turborepo monorepo, pnpm workspaces with a catalog

Web and worker are separate processes with genuinely different runtimes. A
monorepo keeps them on one dependency graph while `packages/config` makes drift
between them impossible. Versions live once, in the `catalog:` block of
`pnpm-workspace.yaml`.

### Inngest for orchestration

Department workflows pause for approval and resume hours later. That is durable
execution, not a job queue. Inngest gives us `step.run` memoisation,
`step.invoke` fan-out and `step.waitForEvent` gates, and it works on both Vercel
and a self-hosted worker.

**Rejected:** BullMQ + Redis. We would hand-roll step state, resume logic,
replay and observability to arrive at the same behaviour.

### Supabase Postgres with pgvector

Memory chunks and their embeddings live in the same database as everything they
relate to, so a write is one transaction and the two can never drift. RLS
extends to embeddings. Hybrid retrieval is a single SQL function.

**Rejected:** Qdrant. Better vector features, but a second datastore to keep in
sync and outside the RLS boundary.

### Prisma 7 with the driver adapter

Prisma 7's `prisma.config.ts` has **no `directUrl` field** — migrations use
`datasource.url`. Since Supabase's transaction pooler cannot run DDL, the config
points at `DIRECT_DATABASE_URL` while the application connects through the
pooled `DATABASE_URL` via `PrismaPg`.

Prisma owns the relational schema. Vectors, HNSW indexes, RLS policies and RPC
functions are hand-written SQL in `infra/sql/`, because Prisma cannot express
them.

### Multi-provider models behind a ModelRouter

Departments request a _role_ (`reasoning`, `drafting`, `bulk`, `embedding`), not
a model. Swapping a provider for one department is a config edit.

### Risk-tiered tools rather than a global autonomy setting

Autonomy is a property of the action, not of the agent. Read and internal
actions run free; anything that leaves the system or spends money stops at an
approval gate. The check lives in the executor, so no prompt can bypass it, and
an expired approval means the action never happened.

### TypeScript pinned to 6.0.3

TypeScript 7 (the native compiler) is released, but `typescript-eslint@8`
declares a peer range of `>=4.8.4 <6.1.0`. Adopting 7 now would silently disable
type-aware linting — the rules that catch floating promises and unsafe `any`
flow. Revisit when typescript-eslint ships TS 7 support.

### Vercel + Supabase Cloud, with Docker kept working

Fastest path with no ops. The Compose stack and both Dockerfiles are maintained
from day one so self-hosting never becomes a rewrite. Local host ports are
offset (Postgres `55432`, web `3200`) so the stack coexists with other projects.

## Consequences

- Every runtime dependency of `apps/worker` must be declared in its own
  `dependencies`: bundling inlines `@nexusai/*`, so externals become imports the
  worker itself resolves, and pnpm's isolated `node_modules` will not supply
  undeclared transitives.
- `SHADOW_DATABASE_URL` is required for drift checking and points at a throwaway
  database Prisma resets on every run.
- Phase 1 must land the Policy layer before any multi-user work, since Prisma
  bypasses RLS.
