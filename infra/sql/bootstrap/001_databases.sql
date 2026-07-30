-- Runs once, on an empty Postgres volume.
--
-- Its only job is creating the auxiliary databases. Extensions are NOT installed
-- here: the first Prisma migration installs its own, so that applying migrations
-- to any empty database produces a working schema with no out-of-band setup
-- step. That property is what lets `prisma migrate diff` replay history into a
-- freshly reset shadow database.

-- Replays migration history during `pnpm db:migrate:check`. Prisma RESETS it on
-- every run, so it must never hold anything real.
SELECT 'CREATE DATABASE nexusai_shadow'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nexusai_shadow')
\gexec

-- One test database per package.
--
-- The integration suites TRUNCATE every table between tests, and turbo runs
-- package tests in parallel. Sharing one database meant a suite's reset wiped
-- another suite's fixtures mid-test, producing failures that looked like
-- foreign-key bugs and moved around between runs. Separate databases are the fix
-- that keeps the parallelism.
SELECT 'CREATE DATABASE nexusai_test'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nexusai_test')
\gexec

SELECT 'CREATE DATABASE nexusai_test_agents'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nexusai_test_agents')
\gexec

-- Inngest's own state: queues, step results, paused workflows. Separate from the
-- application's database because Inngest owns its schema and migrates it itself
-- — mixing them would put two migration systems in one namespace.
SELECT 'CREATE DATABASE inngest'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'inngest')
\gexec
