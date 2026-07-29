# Seed

`pnpm db:seed` brings the database to a known state. It is idempotent — running
it after every pull is safe and is the intended workflow.

## What it always writes

| Thing                             | Behaviour on re-run                                  |
| --------------------------------- | ---------------------------------------------------- |
| Workspace                         | Updated in place                                     |
| System settings                   | Descriptions refreshed, values left alone            |
| Permission vocabulary             | Upserted from `permissions.ts`                       |
| Roles and their permission matrix | **Replaced** from code — code is the source of truth |
| Departments and charters          | Updated from `charters.ts`                           |
| Memory documents                  | Upserted by content hash; identical text is a no-op  |

## What it writes only once

Goals, KPIs and onboarding tasks are seeded **only when the workspace has none**.
Re-running never resurrects a placeholder you deleted, and never overwrites a
goal you edited.

To start over deliberately:

```bash
pnpm infra:reset && pnpm db:migrate && pnpm db:seed
```

## Replacing the placeholder content

Everything fake is tagged `[PLACEHOLDER]` in its title so it is impossible to
mistake for real. There are two ways to replace it.

**In the app.** Edit goals and KPIs directly in the UI and delete the
placeholders. Nothing here fights you.

**In code**, if you would rather keep the seed as your source of truth: edit
`placeholder.ts`, clear the existing rows, and re-seed.

```bash
# from the repo root
psql "$DIRECT_DATABASE_URL" -c "DELETE FROM goal; DELETE FROM kpi; DELETE FROM task;"
pnpm db:seed
```

## Adding your own memory

Drop markdown files into `packages/db/prisma/seed/memory/`. Every `.md` file
there is ingested as a memory document on the next seed, keyed by content hash —
so editing a file re-ingests it and leaving it alone does nothing.

The highest-value things to add first:

- Past decisions and why they were made
- Project and business context the departments should not have to ask about
- Samples of your own writing, which is what Marketing calibrates its voice against
- Meeting notes and anything you would otherwise have to re-explain

Documents are stored without embeddings. The embedding backfill picks them up on
its next pass, which is why seeding needs no API key and costs nothing.

## Environment overrides

| Variable              | Default         |
| --------------------- | --------------- |
| `SEED_WORKSPACE_SLUG` | `nexus`         |
| `SEED_WORKSPACE_NAME` | `NexusAI`       |
| `SEED_TIMEZONE`       | `Europe/Lisbon` |
| `SEED_CURRENCY`       | `EUR`           |

Timezone drives scheduled work and every date the UI renders, so set it before
Operations starts running things on a clock.
