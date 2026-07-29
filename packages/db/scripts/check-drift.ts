import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

/**
 * Fails when `schema.prisma` describes something the migration history does not
 * produce — the drift that turns "it worked locally" into a broken deploy.
 *
 * This exists as a script rather than an inline package.json command because
 * `$VAR` interpolation is not portable across cmd.exe and POSIX shells.
 */
// Prisma 7 dropped the `--shadow-database-url` flag; the URL now comes from
// `datasource.shadowDatabaseUrl` in prisma.config.ts.
if (!process.env['SHADOW_DATABASE_URL']) {
  console.error(
    'SHADOW_DATABASE_URL must be set to check for schema drift.\n' +
      'It must point at a database Prisma is allowed to reset — never your real one.',
  )
  process.exit(1)
}

const result = spawnSync(
  'prisma',
  [
    'migrate',
    'diff',
    '--from-migrations',
    './prisma/migrations',
    '--to-schema',
    './prisma/schema.prisma',
    '--exit-code',
  ],
  { stdio: 'inherit', shell: true },
)

// `--exit-code` returns 2 when a diff exists, 0 when the schema and migrations agree.
if (result.status === 2) {
  console.error(
    '\nSchema drift detected: prisma/schema.prisma does not match its migration history.\n' +
      'Run `pnpm db:migrate` to generate the missing migration.',
  )
  process.exit(1)
}

process.exit(result.status ?? 1)
