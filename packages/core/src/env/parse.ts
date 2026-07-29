import { z } from 'zod'

export class EnvironmentValidationError extends Error {
  override readonly name = 'EnvironmentValidationError'

  constructor(scope: string, details: string) {
    super(
      `Invalid ${scope} environment configuration.\n\n${details}\n` +
        `Fix your .env file (see .env.example) and restart. ` +
        `Set SKIP_ENV_VALIDATION=1 only for build steps that never read these values.`,
    )
  }
}

/**
 * Parse and freeze an environment object, failing loudly at boot rather than
 * producing an `undefined` that surfaces as a confusing runtime error later.
 *
 * `SKIP_ENV_VALIDATION` exists for Docker image builds and CI type checks,
 * where the app is compiled but never actually connects to anything.
 */
export function parseEnv<TSchema extends z.ZodType>(
  scope: string,
  schema: TSchema,
  source: Record<string, string | undefined>,
): z.infer<TSchema> {
  if (source['SKIP_ENV_VALIDATION'] === '1' || source['SKIP_ENV_VALIDATION'] === 'true') {
    return source as z.infer<TSchema>
  }

  const result = schema.safeParse(source)
  if (!result.success) {
    throw new EnvironmentValidationError(scope, z.prettifyError(result.error))
  }

  return Object.freeze(result.data) as z.infer<TSchema>
}
