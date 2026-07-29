# NexusAI

A personal AI operating system. Not a chatbot — an intelligent company made of
AI departments that share one long-term memory, delegate work to each other, and
execute real actions under human supervision.

> **Status: Phase 1 complete.** You can sign in, talk to the CEO, watch it search
> long-term memory, and follow any answer back to the exact text it was given.
> Everything runs locally with no API key and no cost; adding keys switches it to
> real models without a code change.

## Getting started

Requires Node 24+, Docker, and pnpm 11 (`npm i -g pnpm`).

```bash
pnpm install
cp .env.example .env          # generate AUTH_SECRET and CREDENTIAL_ENCRYPTION_KEY
pnpm infra:up                 # postgres+pgvector, redis, minio, inngest
pnpm db:migrate               # apply migrations
pnpm db:seed                  # workspace, departments, permissions, placeholder content
pnpm db:embed                 # chunk and embed what the seed wrote
pnpm dev                      # web on :3200
```

Then open http://localhost:3200 and create the first account. It becomes the
owner, and registration closes behind it.

Host ports are offset from the usual defaults (Postgres `55432`, web `3200`) so
this stack coexists with other projects already bound to `5432` and `3000`.

### Running without API keys

Leave `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` blank and everything still works.
The kernel routes to a deterministic mock that drives the real tool loop —
searching memory, calling tools, recording runs — so the whole system can be
built and verified before deciding to spend anything. The UI says **Mock models**
wherever that is true, because an assistant that is quietly fake is worse than
one that is loudly fake.

Add the keys and run `pnpm db:embed` again to replace the mock vectors.

## Architecture at a glance

```
Presentation   apps/web            Next.js App Router · RSC · Motion
API            route handlers      + server actions, all behind the Policy layer
Orchestration  Inngest             durable steps · fan-out · approval gates  (Phase 2)
Agent kernel   packages/agents     DepartmentAgent · risk-tiered tools · ModelRouter
Domain         packages/core       pure logic, no workspace dependencies
Integrations   packages/integrations   one connector per provider           (Phase 9)
Data           packages/db         Prisma 7 · Postgres · pgvector
```

Dependencies point downward only, enforced by lint rather than convention
(`layerBoundaries()` in `packages/config/eslint/base.js`).

### Three ideas do the heavy lifting

**Risk-tiered tools.** Every tool declares a tier: `read`, `internal`,
`external`, `financial`. Anything that leaves the system pauses on an approval
gate before it executes. That check lives _inside_ the tool's own execute
function, so no call path can skip it — and beneath it a Postgres trigger
refuses to record a high-risk call as succeeded without an approved request.
An approval that expires means the action did not happen.

**One shared memory, retrieved two ways.** All departments read and write the
same store. Retrieval fuses full-text and vector search by Reciprocal Rank
Fusion in a single Postgres function, because semantic search alone misses exact
names and keyword search alone misses paraphrase. The seeded corpus demonstrates
it: a note reading "we settled on forty-nine euros a month" is found by the query
"pricing" despite containing no form of that word.

**Everything is traceable.** Each agent invocation writes a run, its steps, its
tool calls, and the ids of the memory chunks each step was given. Any answer
links to the run that produced it, and the run shows the exact text it read.

## Commands

| Command                                                  | What it does                                        |
| -------------------------------------------------------- | --------------------------------------------------- |
| `pnpm dev`                                               | Web and worker with hot reload                      |
| `pnpm lint` / `pnpm typecheck`                           | Static checks across every package                  |
| `pnpm test`                                              | Unit and integration tests (Vitest)                 |
| `pnpm test:e2e`                                          | Browser tests (Playwright)                          |
| `pnpm build`                                             | Production build                                    |
| `pnpm db:migrate` / `db:seed` / `db:embed` / `db:studio` | Database workflow                                   |
| `pnpm db:migrate:check`                                  | Fails if the schema has drifted from its migrations |
| `pnpm infra:up` / `infra:down` / `infra:reset`           | Local service stack                                 |
| `pnpm format`                                            | Prettier across the repo                            |

## Layout

```
apps/web          Next.js application — dashboard, department consoles, approvals, memory
apps/worker       always-on process for work that outlives a request
packages/core     domain types, risk tiers, org chart, Policy layer, env validation
packages/db       Prisma schema, migrations, repositories, seed
packages/agents   the kernel, tool registry, model router, memory pipeline
packages/ui       OKLCH token layer, motion tokens, components
packages/config   shared TypeScript / ESLint / Vitest presets
infra/            docker compose, Dockerfiles, bootstrap SQL
docs/             architecture notes and decision records
```

## Making it yours

Everything seeded is tagged `[PLACEHOLDER]` so invented numbers can never be
mistaken for real ones. Two ways to replace them:

- **Talk to the CEO.** Describe your business and what you want off your plate;
  it writes that into memory and every department reads it.
- **Drop markdown into `packages/db/prisma/seed/memory/`** and run `pnpm db:seed
&& pnpm db:embed`. That directory is gitignored, so your own notes stay out of
  version control.

See `packages/db/prisma/seed/README.md` for the full swap.

## Notable version constraints

- **TypeScript is pinned to 6.0.3.** TypeScript 7 is released, but
  `typescript-eslint@8` declares `typescript <6.1.0`; upgrading before that peer
  range moves would silently disable type-aware linting.
- **Prisma 7's `prisma.config.ts` has no `directUrl`.** Migrations use
  `datasource.url`, so that points at `DIRECT_DATABASE_URL` while the app
  connects through the pooled `DATABASE_URL`.
- **`cacheComponents` is off**, deliberately — see the reasoning in
  `apps/web/next.config.ts`.
- **`exactOptionalPropertyTypes` is off in `packages/agents` only**, because the
  AI SDK's types are not authored for it. It stays on everywhere else.

## Known limitations

- **Scheduled work only runs while the machine is awake.** A workstation that
  sleeps is not an always-on company. Inngest catches up on boot rather than
  losing runs, but time-of-day guarantees need an always-on host — a ~€7/month
  VPS, revisited at Phase 3.
- **Row-level security is deliberately not enabled.** Nothing reaches the
  database except this application, so the Policy layer is the only
  authorization control and is tested accordingly. See `docs/ADR/0001`.
