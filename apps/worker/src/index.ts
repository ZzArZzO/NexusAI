import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'

/**
 * Entry point. Its only job is to load the environment BEFORE any application
 * module is evaluated.
 *
 * ESM hoists imports, so a top-level `import './main'` would run main's module
 * body — and everything it imports, including the logger reading LOG_LEVEL —
 * before this file's first statement. The dynamic import is what makes the
 * ordering explicit rather than accidental.
 */
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })

await import('./main')
