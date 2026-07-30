import { z } from 'zod'

import { parseEnv } from './parse'

/**
 * Server-only environment. Importing this from a client component is a bug —
 * these are secrets and must never reach the browser bundle.
 */

/** 32 raw bytes, base64-encoded. */
const base64Key32 = z
  .string()
  .refine(
    (value) => Buffer.from(value, 'base64').length === 32,
    'must be exactly 32 bytes, base64-encoded (openssl rand -base64 32)',
  )

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3200'),
  /**
   * Extra origins allowed to post to the auth endpoints, comma-separated.
   *
   * APP_URL is always trusted. This exists for the cases where the app is
   * legitimately reached on another origin — a LAN address, a tunnel, or the E2E
   * server on its own port. Deliberately an allowlist rather than a wildcard: it
   * is the CSRF boundary.
   */
  TRUSTED_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // --- Database ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /**
   * Prisma Migrate needs to run DDL. Identical to DATABASE_URL locally; they
   * differ only behind a transaction-mode pooler, which cannot.
   */
  DIRECT_DATABASE_URL: z.string().min(1, 'DIRECT_DATABASE_URL is required'),

  // --- Authentication ---
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

  /**
   * Model providers are optional.
   *
   * Absent, the agent kernel runs against a deterministic mock: every code path
   * executes and every test passes, but no request leaves the machine and
   * nothing is charged. Present, the same code talks to real models. Making
   * these optional is what lets the whole system be built and verified before
   * anyone has decided to spend money on it.
   */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  // --- Orchestration ---
  INNGEST_EVENT_KEY: z.string().min(1).default('local-dev-key'),
  INNGEST_SIGNING_KEY: z.string().min(1).default('local-dev-signing-key'),
  INNGEST_BASE_URL: z.url().optional(),

  // --- Object storage ---
  STORAGE_ENDPOINT: z.url().default('http://localhost:59000'),
  STORAGE_ACCESS_KEY: z.string().default('nexus'),
  STORAGE_SECRET_KEY: z.string().default('nexussecret'),
  STORAGE_BUCKET: z.string().default('nexusai'),

  // --- Crypto ---
  /** Envelope-encrypts integration credentials at rest. */
  CREDENTIAL_ENCRYPTION_KEY: base64Key32,
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | undefined

/** Lazily validated so importing this module never crashes a client bundle build. */
export function serverEnv(): ServerEnv {
  cached ??= parseEnv('server', serverEnvSchema, process.env)
  return cached
}

/**
 * Whether real model providers are configured.
 *
 * The kernel branches on this to choose its provider, and the UI shows it, so
 * "why are the answers strange" has an obvious answer rather than being a
 * mystery to debug.
 */
export function hasModelProviders(): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY'] && process.env['OPENAI_API_KEY'])
}
