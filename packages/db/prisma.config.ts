import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

// One canonical .env at the repo root â€” loaded explicitly because the Prisma CLI
// runs with this package as its working directory.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

/**
 * Prisma 7 moved datasource configuration out of `schema.prisma` and into this file.
 *
 * Important: `defineConfig`'s datasource has no `directUrl` field â€” the CLI uses
 * `datasource.url` for every migration operation. Supabase's pooled connection
 * (PgBouncer, transaction mode) cannot run DDL, so migrations must point at the
 * DIRECT connection here. The application meanwhile connects through the POOLED
 * `DATABASE_URL` via the driver adapter in `src/client.ts`.
 */
const migrationUrl = process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL']
const shadowUrl = process.env['SHADOW_DATABASE_URL']

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
    seed: 'tsx prisma/seed/index.ts',
  },
  // Keys are omitted rather than set to undefined so `prisma generate` still
  // works in CI and Docker builds, where no database URL exists.
  ...(migrationUrl
    ? {
        datasource: {
          url: migrationUrl,
          ...(shadowUrl ? { shadowDatabaseUrl: shadowUrl } : {}),
        },
      }
    : {}),
})
