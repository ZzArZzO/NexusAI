import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  CredentialCryptoError,
  keyRingFromEnv,
  needsRotation,
  open,
  safeEqual,
  seal,
  type KeyRing,
} from './crypto'

const KEY_A = randomBytes(32).toString('base64')
const KEY_B = randomBytes(32).toString('base64')

function ring(env: Record<string, string>): KeyRing {
  return keyRingFromEnv(env)
}

describe('credential envelope', () => {
  it('round-trips an object', () => {
    const keys = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A })
    const sealed = seal({ refreshToken: 'rt_abc', scope: ['mail'] }, keys)

    expect(open(sealed.envelope, keys)).toEqual({ refreshToken: 'rt_abc', scope: ['mail'] })
  })

  it('produces a different ciphertext each time for identical plaintext', () => {
    const keys = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A })

    // A fresh IV per seal. Without it, identical credentials produce identical
    // ciphertext and the database leaks which connections share a token.
    const first = seal({ token: 'same' }, keys)
    const second = seal({ token: 'same' }, keys)

    expect(Buffer.from(first.envelope).equals(Buffer.from(second.envelope))).toBe(false)
    expect(open(first.envelope, keys)).toEqual(open(second.envelope, keys))
  })

  it('refuses a ciphertext altered by one bit', () => {
    const keys = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A })
    const sealed = seal({ token: 'secret' }, keys)

    const tampered = Buffer.from(sealed.envelope)
    const last = tampered.length - 1
    tampered[last] = (tampered[last] ?? 0) ^ 0x01

    expect(() => open(tampered, keys)).toThrow(CredentialCryptoError)
  })

  it('refuses a tampered auth tag', () => {
    const keys = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A })
    const sealed = seal({ token: 'secret' }, keys)

    const tampered = Buffer.from(sealed.envelope)
    // The tag sits at bytes 14..30 — flipping it must fail authentication rather
    // than producing garbage plaintext.
    tampered[16] = (tampered[16] ?? 0) ^ 0xff

    expect(() => open(tampered, keys)).toThrow(/failed authentication/i)
  })

  it('refuses a credential sealed under a different key', () => {
    const sealed = seal({ token: 'secret' }, ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A }))

    expect(() => open(sealed.envelope, ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_B }))).toThrow(
      CredentialCryptoError,
    )
  })

  it('refuses a truncated envelope', () => {
    const keys = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A })
    const sealed = seal({ token: 'secret' }, keys)

    expect(() => open(sealed.envelope.subarray(0, 12), keys)).toThrow(/truncated/i)
  })

  it('names the missing key version rather than failing opaquely', () => {
    const two = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A, CREDENTIAL_ENCRYPTION_KEY_V2: KEY_B })
    const sealed = seal({ token: 'secret' }, two)
    expect(sealed.keyVersion).toBe(2)

    const onlyV1 = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A })
    expect(() => open(sealed.envelope, onlyV1)).toThrow(/key version 2/)
  })
})

describe('key ring', () => {
  it('writes with the highest version and still reads the older one', () => {
    const v1Only = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A })
    const old = seal({ token: 'old' }, v1Only)

    const rotated = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A, CREDENTIAL_ENCRYPTION_KEY_V2: KEY_B })

    // The point of the ring: rotation must not make existing rows unreadable.
    expect(rotated.current).toBe(2)
    expect(open(old.envelope, rotated)).toEqual({ token: 'old' })
    expect(seal({ token: 'new' }, rotated).keyVersion).toBe(2)
  })

  it('flags envelopes that are not on the current key', () => {
    const rotated = ring({ CREDENTIAL_ENCRYPTION_KEY: KEY_A, CREDENTIAL_ENCRYPTION_KEY_V2: KEY_B })

    expect(needsRotation(1, rotated)).toBe(true)
    expect(needsRotation(2, rotated)).toBe(false)
  })

  it('refuses a key that is not 32 bytes', () => {
    expect(() => ring({ CREDENTIAL_ENCRYPTION_KEY: 'dG9vLXNob3J0' })).toThrow(/32 bytes/)
  })

  it('refuses to run with no key at all', () => {
    expect(() => ring({})).toThrow(/No credential encryption key/)
  })
})

describe('safeEqual', () => {
  it('compares equal strings', () => {
    expect(safeEqual('sha256=abc', 'sha256=abc')).toBe(true)
  })

  it('rejects different strings of the same length', () => {
    expect(safeEqual('sha256=abc', 'sha256=abd')).toBe(false)
  })

  it('rejects different lengths without throwing', () => {
    // timingSafeEqual throws on a length mismatch; a signature check that throws
    // where it should return false becomes a 500 instead of a 401.
    expect(safeEqual('short', 'much longer value')).toBe(false)
  })
})
