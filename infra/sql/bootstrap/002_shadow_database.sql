-- The shadow database used by `prisma migrate diff` to replay migration history.
--
-- Prisma resets it on every drift check, so it must be a throwaway. Extensions
-- are installed here as well: migrations from Phase 1 onward create
-- `extensions.vector(1536)` columns, which cannot replay into a database where
-- the extension does not exist.

SELECT 'CREATE DATABASE nexusai_shadow'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nexusai_shadow')
\gexec

\connect nexusai_shadow

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path TO public, extensions',
    current_database()
  );
END
$$;
