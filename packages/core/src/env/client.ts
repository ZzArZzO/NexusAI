import { z } from 'zod'

import { parseEnv } from './parse'

/**
 * Public environment. Everything here is inlined into the browser bundle,
 * so it must contain nothing secret.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

/**
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when accessed as a static
 * property, so the values are destructured explicitly rather than passing
 * `process.env` wholesale.
 */
export function clientEnv(): ClientEnv {
  return parseEnv('client', clientEnvSchema, {
    SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
}
