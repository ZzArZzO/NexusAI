import { describe, expect, test } from 'vitest'
import { z } from 'zod'

import { EnvironmentValidationError, parseEnv } from './parse'

const schema = z.object({
  APP_URL: z.url(),
  PORT: z.coerce.number().int().positive(),
})

describe('parseEnv', () => {
  test('returns parsed values when the environment is valid', () => {
    // Arrange
    const source = { APP_URL: 'https://nexus.local', PORT: '3000' }

    // Act
    const env = parseEnv('test', schema, source)

    // Assert
    expect(env).toEqual({ APP_URL: 'https://nexus.local', PORT: 3000 })
  })

  test('freezes the result so config cannot be mutated at runtime', () => {
    const env = parseEnv('test', schema, { APP_URL: 'https://nexus.local', PORT: '3000' })

    expect(Object.isFrozen(env)).toBe(true)
  })

  test('throws EnvironmentValidationError when a variable is missing', () => {
    expect(() => parseEnv('test', schema, { PORT: '3000' })).toThrow(EnvironmentValidationError)
  })

  test('names the offending variable in the error message', () => {
    // Arrange
    const source = { APP_URL: 'not-a-url', PORT: '3000' }

    // Act
    let message = ''
    try {
      parseEnv('server', schema, source)
    } catch (error) {
      message = (error as Error).message
    }

    // Assert
    expect(message).toContain('APP_URL')
    expect(message).toContain('server')
  })

  test('skips validation when SKIP_ENV_VALIDATION is set', () => {
    // Arrange â€” deliberately invalid input that would otherwise throw
    const source = { SKIP_ENV_VALIDATION: '1', PORT: 'not-a-number' }

    // Act
    const env = parseEnv('test', schema, source)

    // Assert
    expect(env).toBe(source)
  })
})
