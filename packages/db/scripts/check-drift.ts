import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

/**
 * Fails when `schema.prisma` describes something the migration history does not
 * produce — the drift that turns "it worked locally" into a broken deploy.
 *
 * ## Why this is not simply "the diff must be empty"
 *
 * Three things in this schema cannot be expressed in Prisma's datamodel at all:
 * the HNSW index on the embedding column, the GIN index on the generated
 * `tsvector`, and the generated-column expression itself. The migration creates
 * them in raw SQL, so `migrate diff` will always report them as divergence no
 * matter how correct the schema is.
 *
 * Treating that as failure would train everyone to ignore a red check, which is
 * worse than having no check. Instead the known divergence is committed to
 * `prisma/expected-drift.txt`, reviewed like any other file, and compared
 * exactly. Anything new — an added model, a changed column, a forgotten
 * migration — changes the output and fails the check.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXPECTED_PATH = fileURLToPath(new URL('../prisma/expected-drift.txt', import.meta.url))

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
  ],
  { cwd: PACKAGE_ROOT, encoding: 'utf8', shell: true },
)

if (result.status !== 0 && result.status !== 2) {
  console.error(result.stderr || result.stdout)
  process.exit(1)
}

/**
 * Strip the CLI banner, blank lines and `#` comments, so the comparison is about
 * the diff itself and the snapshot file can carry an explanation of why each
 * entry is expected.
 */
function normalise(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(
      (line) => line !== '' && !line.startsWith('Loaded Prisma config') && !line.startsWith('#'),
    )
    .join('\n')
    .trim()
}

const actual = normalise(result.stdout)

let expected: string
try {
  expected = normalise(readFileSync(EXPECTED_PATH, 'utf8'))
} catch {
  console.error(
    `Missing ${EXPECTED_PATH}.\n\n` +
      'Create it with the reviewed, expected divergence:\n' +
      '  cd packages/db && npx prisma migrate diff --from-migrations ./prisma/migrations ' +
      '--to-schema ./prisma/schema.prisma > prisma/expected-drift.txt',
  )
  process.exit(1)
}

if (actual === expected) {
  console.warn('Schema and migrations agree (known raw-SQL divergence unchanged).')
  process.exit(0)
}

console.error('\nSchema drift detected.\n')
console.error('Expected divergence:\n')
console.error(expected || '  (none)')
console.error('\nActual divergence:\n')
console.error(actual || '  (none)')
console.error(
  '\nIf you changed schema.prisma, generate a migration:\n' +
    '  pnpm db:migrate\n\n' +
    'If you deliberately added raw SQL that Prisma cannot express, review the new\n' +
    'divergence and update the snapshot:\n' +
    '  cd packages/db && npx prisma migrate diff --from-migrations ./prisma/migrations ' +
    '--to-schema ./prisma/schema.prisma > prisma/expected-drift.txt\n',
)
process.exit(1)
