# Runbook

Operating NexusAI: starting it, going live, and what to do when something is
wrong. Written for the one person who runs this, on the assumption that when they
read it they are annoyed and in a hurry.

---

## Start it

```bash
docker compose -f infra/compose.yml up -d     # postgres+pgvector, redis, minio, inngest
pnpm db:migrate && pnpm db:seed               # schema, then workspace + departments
pnpm dev                                      # web :3200, worker, inngest UI :58288
```

First visit creates the operator account. **Registration closes after that
account exists** — additional people are added by creating a `Membership`, never
by signing up.

Nothing needs an API key. Absent one, every agent runs on a deterministic mock:
every code path executes, every test passes, no request leaves the machine and
nothing is charged. The UI says so rather than pretending.

### Verify it is actually working

```bash
curl -s localhost:3200/api/health | jq        # database reachability
pnpm lint && pnpm typecheck && pnpm test      # 187 unit + integration tests
pnpm test:e2e                                 # 37 browser tests against a prod build
```

Manual acceptance, in order — each step depends on the previous one working:

1. Sign in. The dashboard streams; panels fill in individually.
2. `⌘K` → CEO. Ask _"What did we decide about pricing?"_ The reply cites memory.
3. Open the run from the dashboard. Every step, tool call and retrieved chunk is
   listed, and the chunk text is the text the model was actually handed.
4. Ask the CEO to create a task. It appears on `/tasks`.
5. `/settings/integrations` — six connectors, nothing connected, capabilities
   shown as unavailable rather than hidden.

---

## Go live

### 1. Model providers

Put real keys in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-…
OPENAI_API_KEY=sk-…          # embeddings only (text-embedding-3-small, 1536d)
```

Then embed the seeded memory, which was stored unembedded because the mock's
vectors are deterministic nonsense and would poison retrieval:

```bash
pnpm db:embed
```

Restart the dev server. `/settings` stops saying "mock".

### 2. Set a spend limit before the first real run

`/settings` → Monthly model budget. Autonomous work stops at the limit; chat does
not, because locking you out punishes the one person who can decide what to do.
Expect roughly **$40–45/month** on the frugal profile at the modelled load, and
note that a limit of `0` means "no autonomous spending", while empty means "no
limit" — they are different on purpose.

### 3. Connect what you actually need

`/settings/integrations`. Credentials are validated against each connector's
schema, encrypted with AES-256-GCM before they touch the database, and never shown
again. Connecting grants nothing on its own: each department only receives the
capabilities it was granted, so connecting Slack does not let Finance post.

For webhooks, put the provider's signing secret in the connection's settings as
`webhookSecret` and point the provider at the URL shown on the card. An event with
a bad signature is stored and never processed.

### 4. Always-on

**Known limitation:** a workstation that sleeps does not run scheduled work.
Inngest catches up on boot rather than losing runs, so nothing is lost — but
"the 7am brief" arrives whenever the machine wakes. If time-of-day matters, move
the stack to a small VPS (~€5–9/month, cheaper than the managed alternative and it
fixes this).

---

## When something is wrong

### Sign-in does nothing — no error, back to the sign-in page

Three causes, all of them cookie-related, all of them previously real:

| Symptom                                       | Cause                           | Fix                                                                                                |
| --------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Cookie in the response, absent in the browser | `Secure` cookie over plain HTTP | `APP_URL` must match the scheme actually served. `USE_SECURE_COOKIES` derives from it.             |
| `403 Invalid origin` in the console           | Origin not trusted              | Add it to `TRUSTED_ORIGINS` (comma-separated). It is the CSRF boundary — no wildcards.             |
| Request goes to the wrong port                | A hardcoded client base URL     | The browser client takes no `baseURL`; it uses the origin it was served from. Do not add one back. |

Check the first with `curl -i -X POST localhost:3200/api/auth/sign-in/email …` and
look at the cookie name: `nexus.session_token` over HTTP, `__Secure-nexus.…` over
HTTPS. Anything else is the bug.

### An agent says an action succeeded when it did not

It should be impossible, and there are three independent locks. Verify each:

```sql
-- 1. Was an approval created?
select id, status, risk, expires_at from approval_request order by created_at desc limit 5;

-- 2. Is any high-risk call recorded as succeeded without one?
select tc.id, tc.tool_name, tc.risk, tc.status
from tool_call tc left join approval_request ar on ar.tool_call_id = tc.id
where tc.risk in ('external','financial') and tc.status = 'succeeded'
  and (ar.id is null or ar.status <> 'approved');
```

The second query must return **zero rows**. The `tool_call_approval_gate` trigger
refuses such an insert, so a non-empty result means the trigger is missing — check
that the `_init` migration applied fully.

### Scheduled work is not running

In order of likelihood:

1. **Paused.** `⌘K` → Resume. The switch is checked before every autonomous run.
2. **Over budget.** `/settings`. The dashboard's System health row says so too.
3. **Inngest cannot reach the app.** It runs in a container, so it cannot call
   `localhost`. The serve endpoint advertises `host.docker.internal:3200` in
   development; set `INNGEST_SERVE_ORIGIN` otherwise. Symptom: "Unable to reach
   SDK URL" in the Inngest UI, which looks like a broken workflow and is a broken
   hostname.
4. **Signing key.** `INNGEST_SIGNING_KEY` must be pure hex, with no `signkey-`
   prefix.

### A workflow is parked forever

`step.waitForEvent` uses an `if:` expression, not `match:` — `match:` compares
against the _triggering_ event, so a campaign gate never resumes. If a run sits in
`awaiting_approval` past its expiry, the approval expired, and **expired means the
action did not happen**. That is by construction, not a failure.

### Retrieval returns nothing useful

```sql
select count(*) as chunks, count(embedding) as embedded from memory_chunk;
```

`embedded < chunks` means `pnpm db:embed` has not run since the last ingest. If
both are equal and results are still poor, check the indexes survived — the
`_department_domain` migration deliberately omits three statements Prisma wanted
to generate, because applying them would drop the HNSW and GIN indexes and
silently destroy hybrid search:

```sql
select indexname from pg_indexes where tablename = 'memory_chunk';
-- expect memory_chunk_embedding_idx and memory_chunk_fts_idx
```

### `pnpm db:migrate:check` fails

It compares live drift against `packages/db/prisma/expected-drift.txt`, which is
the reviewed, permanent divergence (vector columns, generated columns, functions,
triggers — things Prisma cannot express). A failure means _new_ drift. Read the
diff; do not regenerate the snapshot to make it pass.

### Costs look wrong

Cost is integer micro-dollars, priced at the higher of input/output rates, and
counts **failed runs too** — a run that died halfway still burned tokens, and a
budget that only counted successes would understate the bill by exactly the amount
you most want to see.

```sql
select date_trunc('day', started_at) as day, sum(cost_micros)/1000000.0 as usd, count(*)
from run group by 1 order by 1 desc limit 14;
```

---

## Routine maintenance

| When                                   | Do                                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After editing charters or tool grants  | `pnpm db:seed` — it is idempotent and leaves goals/KPIs alone                                                                                                                                       |
| After ingesting memory with no API key | `pnpm db:embed` once keys are set                                                                                                                                                                   |
| Rotating `CREDENTIAL_ENCRYPTION_KEY`   | Add `CREDENTIAL_ENCRYPTION_KEY_V2`, keep V1, then "Re-encrypt credentials" on the integrations page. **Never remove the old key first** — that makes every stored credential permanently unreadable |
| Before trusting a new connector        | Its tools default to `external` if declared so; MCP tools default to `external` always. Lower a tier only after reading what the tool does                                                          |

## Backups

Everything durable is in Postgres. One volume, one command:

```bash
docker exec nexusai-postgres pg_dump -U nexus nexusai | gzip > nexus-$(date +%F).sql.gz
```

That includes memory, embeddings, audit log, and encrypted credentials — which are
useless without `CREDENTIAL_ENCRYPTION_KEY`. **Back the key up separately.** A
database dump without it is a backup that cannot be restored into a working
system, and finding that out during a restore is the worst possible time.
