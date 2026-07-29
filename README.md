# NexusAI

A personal AI operating system. Not a chatbot — an intelligent company made of
AI departments that share one long-term memory, delegate work to each other, and
execute real actions under human supervision.

> **Status: Phase 0 — Foundation.** The monorepo, tooling, database pipeline,
> design system and local infrastructure are in place. Phase 1 adds the schema,
> auth, agent kernel, memory and the first working department (CEO).

## Architecture at a glance

```
Presentation   apps/web            Next.js App Router · RSC · shadcn/ui · Motion
API            route handlers      + server actions, all behind the Policy layer
Orchestration  Inngest             durable steps · fan-out · approval gates
Agent kernel   packages/agents     DepartmentAgent · risk-tiered ToolRegistry · ModelRouter
Domain         packages/core       pure logic, zero workspace dependencies
Integrations   packages/integrations   one connector per provider, hot-swappable
Data           packages/db         Prisma 7 · Postgres · pgvector
```

Dependencies point downward only, and that direction is enforced by lint rather
than by convention (`layerBoundaries()` in `packages/config/eslint/base.js`).

### Two ideas do the heavy lifting

**Risk-tiered tools.** Every tool declares a tier: `read`, `internal`,
`external`, `financial`. Anything that leaves the system pauses on an approval
gate before it executes. The check lives in the executor, outside the model's
reach — an agent cannot argue its way past it, and an expired approval means the
action never happened.

**One shared memory.** All departments read and write the same `memory_*` tables.
Retrieval is hybrid: full-text and vector search fused with Reciprocal Rank
Fusion in a single Postgres function, because semantic search alone misses exact
names and keyword search alone misses paraphrase.

## Getting started

Requires Node 24+, Docker, and pnpm 11 (`npm i -g pnpm`).

```bash
pnpm install
cp .env.example .env          # fill in the blanks
pnpm infra:up                 # postgres+pgvector, redis, minio, inngest
pnpm db:migrate               # apply migrations
pnpm db:seed                  # workspace + default settings
pnpm dev                      # web on :3200, worker, inngest UI on :58288
```

Host ports are offset from the usual defaults (Postgres on `55432`, web on
`3200`) so this stack coexists with other projects already bound to `5432`
and `3000`.

## Commands

| Command                                        | What it does                                        |
| ---------------------------------------------- | --------------------------------------------------- |
| `pnpm dev`                                     | Runs web and worker with hot reload                 |
| `pnpm lint` / `pnpm typecheck`                 | Static checks across every package                  |
| `pnpm test`                                    | Unit and integration tests (Vitest)                 |
| `pnpm test:e2e`                                | Browser tests (Playwright)                          |
| `pnpm build`                                   | Production build of every package                   |
| `pnpm db:migrate` / `db:seed` / `db:studio`    | Database workflow                                   |
| `pnpm db:migrate:check`                        | Fails if the schema has drifted from its migrations |
| `pnpm infra:up` / `infra:down` / `infra:reset` | Local service stack                                 |
| `pnpm format`                                  | Prettier across the repo                            |

## Layout

```
apps/web        Next.js application — UI, API routes, Inngest endpoint
apps/worker     always-on process for work that outlives a request
packages/core   domain types, risk tiers, org chart, env validation
packages/db     Prisma schema, migrations, repositories
packages/ui     OKLCH token layer, motion tokens, components
packages/config shared TypeScript / ESLint / Vitest presets
infra/          docker compose, Dockerfiles, raw SQL (vectors, RLS, RPCs)
docs/           architecture notes and decision records
```

## Notable version constraints

- **TypeScript is pinned to 6.0.3.** TypeScript 7 (the native compiler) is
  released, but `typescript-eslint@8` declares `typescript <6.1.0`. Upgrading
  before that peer range moves would silently disable type-aware linting.
- **Prisma 7 `prisma.config.ts` has no `directUrl` field.** Migrations use
  `datasource.url`, so that entry points at `DIRECT_DATABASE_URL` while the app
  connects through the pooled `DATABASE_URL` via the driver adapter.
- **Next.js `cacheComponents`** replaces the old `experimental.ppr` and
  `experimental.dynamicIO` flags.
