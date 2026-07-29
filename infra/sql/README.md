# Raw SQL

Prisma owns the relational schema. This directory owns everything Prisma cannot
express:

| Concern                                      | Why it lives here                                                  |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Extensions (`vector`, `pg_trgm`, `unaccent`) | Must exist before any migration runs                               |
| `vector(1536)` columns                       | Prisma has no native vector type; surfaced as `Unsupported(...)`   |
| HNSW / GIN indexes                           | Index type and operator class are not expressible in Prisma schema |
| Generated `tsvector` columns                 | Stored generated columns with a text-search expression             |
| `nexus_hybrid_search` RPC                    | Reciprocal Rank Fusion over full-text + semantic results           |
| Row Level Security policies                  | Defense in depth beneath the application Policy layer              |

## Layout

- `bootstrap/` — mounted into the Postgres container's entrypoint. Runs **once**,
  on an empty volume, before Prisma. Local development only; on Supabase the same
  statements are applied through the dashboard or a migration.
- Numbered migration files (added in Phase 1) are applied through
  `prisma migrate` as raw SQL migrations so they are versioned alongside the
  relational schema.

## Re-running bootstrap

The entrypoint scripts only execute on a fresh volume. To re-apply:

```bash
pnpm infra:reset   # docker compose down -v && up -d
```
