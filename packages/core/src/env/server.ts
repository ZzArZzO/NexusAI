import { z } from 'zod'

import { parseEnv } from './parse'

/**
 * Server-only environment. Importing this from a client component is a bug â€”
 * the values here are secrets and must never reach the browser bundle.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // --- Database ---
  // Pooled connection (PgBouncer / Supabase pooler) used by the application at runtime.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Direct connection used by Prisma Migrate. Prisma 7 config has no `directUrl`
  // field, so migrations point at this URL explicitly.
  DIRECT_DATABASE_URL: z.string().min(1, 'DIRECT_DATABASE_URL is required'),

  // --- Supabase ---
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // --- Model providers ---
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),

  // --- Orchestration ---
  INNGEST_EVENT_KEY: z.string().min(1).default('local-dev-key'),
  INNGEST_SIGNING_KEY: z.string().min(1).default('local-dev-signing-key'),
  INNGEST_BASE_URL: z.url().optional(),

  // --- Crypto ---
  // 32 raw bytes, base64-encoded. Used to envelope-encrypt integration credentials.
  // Generate with: openssl rand -base64 32
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'CREDENTIAL_ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded (openssl rand -base64 32)',
    ),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | undefined

/** Lazily validated so importing this module never crashes a client bundle build. */
export function serverEnv(): ServerEnv {
  cached ??= parseEnv('server', serverEnvSchema, process.env)
  return cached
}
