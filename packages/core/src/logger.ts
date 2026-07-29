import { pino, type Logger } from 'pino'

const REDACTED_PATHS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'authorization',
  'credential',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
  'req.headers.authorization',
  'req.headers.cookie',
]

const isDevelopment = process.env.NODE_ENV === 'development'

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Credentials must never reach a log sink, including during a stack dump.
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
})

/**
 * Child logger bound to a subsystem. Use one per module so log lines are
 * filterable: `logger.child({ scope: 'agents/ceo' })`.
 */
export function scopedLogger(scope: string, bindings: Record<string, unknown> = {}): Logger {
  return logger.child({ scope, ...bindings })
}

export type { Logger }
