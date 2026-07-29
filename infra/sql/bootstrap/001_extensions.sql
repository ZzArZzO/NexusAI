-- Runs once, on an empty Postgres volume, before any Prisma migration.
--
-- Supabase provisions extensions into a dedicated `extensions` schema; we mirror
-- that here so the same SQL (`extensions.vector(1536)`) works locally and in
-- production without conditional branches.

CREATE SCHEMA IF NOT EXISTS extensions;

-- Semantic search over memory chunks.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Trigram similarity: fuzzy matching on names, titles and contact records.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Accent-insensitive text search.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Make the extension schema resolvable without qualifying every call.
-- ALTER DATABASE takes a literal name, so the current database is interpolated
-- rather than hardcoded — CI and local use different database names.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path TO public, extensions',
    current_database()
  );
END
$$;
