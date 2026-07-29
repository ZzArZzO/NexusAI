-- Runs once, on an empty Postgres volume.
--
-- Its only job is to create the two auxiliary databases. Extensions are NOT
-- installed here: the first Prisma migration installs its own, so that applying
-- migrations to any empty database produces a working schema with no
-- out-of-band setup step. That property is what lets `prisma migrate diff`
-- replay history into a freshly reset shadow database.

-- Replays migration history during `pnpm db:migrate:check`. Prisma RESETS it on
-- every run, so it must never hold anything real.
SELECT 'CREATE DATABASE nexusai_shadow'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nexusai_shadow')
\gexec

-- Target of the integration test suite, which TRUNCATEs every table between
-- tests. Separate from development data by construction rather than by
-- remembering.
SELECT 'CREATE DATABASE nexusai_test'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nexusai_test')
\gexec
