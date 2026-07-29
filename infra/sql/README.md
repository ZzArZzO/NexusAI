# Raw SQL

Prisma owns the relational schema. This directory owns the little that sits
outside it.

## Bootstrap

`bootstrap/` is mounted into the Postgres container's entrypoint and runs
**once**, on an empty volume. Its only job is creating the two auxiliary
databases:

| Database         | Purpose                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `nexusai_shadow` | `prisma migrate diff` replays history here. Prisma **resets** it every run |
| `nexusai_test`   | Integration tests **truncate every table** here between tests              |

Both are deliberately separate from `nexusai` so that a destructive operation
aimed at the wrong URL cannot reach development data.

## What is _not_ here

Extensions, the `vector` column, the generated `tsvector`, the HNSW index and
the two functions all live inside the **first Prisma migration**, not in this
directory.

That is a deliberate change from how this started. Migrations must be
self-sufficient: applying them to an empty database has to produce a working
schema with no "and also run this other script first" step. Beyond tidiness,
`prisma migrate diff` resets the shadow database before replaying history, which
drops anything installed outside that history — so an extension created only by
bootstrap made the drift check fail with `type "vector" does not exist` even
when the real database was perfectly fine.

## Things Prisma cannot express

Four pieces of the schema exist only as raw SQL inside the migration:

| Thing                                                | Why                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `vector(1536)` column                                | Surfaced to Prisma as `Unsupported(...)`                                                  |
| HNSW index with `m` / `ef_construction`              | Prisma supports Gin/Gist/Brin/Hash/SpGist, not hnsw, and has no operator-class parameters |
| Generated `fts tsvector` column                      | No representation for generated-column expressions                                        |
| `nexus_hybrid_search`, `nexus_enforce_approval_gate` | Functions and triggers are outside the datamodel entirely                                 |

The first three show up permanently in `prisma migrate diff`. Rather than
tolerate a check that is always red — which trains everyone to ignore it — the
known divergence is committed to `packages/db/prisma/expected-drift.txt` and
compared exactly. Anything new fails.

## Re-running bootstrap

Entrypoint scripts execute only on a fresh volume:

```bash
pnpm infra:reset      # docker compose down -v && up -d
pnpm db:migrate       # recreate the schema
pnpm db:seed
```
