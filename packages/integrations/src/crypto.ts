import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Credential encryption.
 *
 * Integration credentials are the highest-value secrets this system holds: a
 * leaked Gmail refresh token reads the operator's mail, a leaked Stripe key moves
 * their money. They are therefore encrypted at rest with a key that lives outside
 * the database, so a dump of Postgres is not a dump of their accounts.
 *
 * AES-256-GCM, not CBC: GCM is authenticated, so a tampered ciphertext fails to
 * decrypt rather than decrypting to attacker-chosen plaintext. The auth tag is
 * stored alongside and verified on every read.
 *
 * The envelope is a self-describing binary layout rather than JSON, because the
 * column is `Bytes` and a JSON wrapper would mean base64 inside base64:
 *
 *   [ 1 byte version ][ 1 byte key version ][ 12 byte iv ][ 16 byte tag ][ ciphertext ]
 *
 * `keyVersion` is also stored in its own column so a rotation can find rows to
 * re-encrypt without decrypting every one of them first.
 */

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const HEADER_BYTES = 2 + IV_BYTES + TAG_BYTES

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialCryptoError'
  }
}

export interface KeyRing {
  /** Version used for new writes. */
  readonly current: number
  /** Every key still needed to read existing rows, by version. */
  readonly keys: ReadonlyMap<number, Buffer>
}

/**
 * Build a key ring from environment values.
 *
 * `CREDENTIAL_ENCRYPTION_KEY` is version 1. Rotation adds
 * `CREDENTIAL_ENCRYPTION_KEY_V2` and so on; the highest version present becomes
 * the write key while the older ones stay readable. That ordering matters — a
 * rotation that drops the old key first makes every stored credential
 * permanently unreadable, and the operator would only find out the next time a
 * connector ran.
 */
export function keyRingFromEnv(env: Record<string, string | undefined> = process.env): KeyRing {
  const keys = new Map<number, Buffer>()

  const primary = env['CREDENTIAL_ENCRYPTION_KEY']
  if (primary) keys.set(1, decodeKey(primary, 'CREDENTIAL_ENCRYPTION_KEY'))

  for (const [name, value] of Object.entries(env)) {
    const match = /^CREDENTIAL_ENCRYPTION_KEY_V(\d+)$/.exec(name)
    if (!match || !value) continue

    const version = Number(match[1])
    if (version < 1 || version > 255) {
      throw new CredentialCryptoError(`${name}: key version must be between 1 and 255.`)
    }
    keys.set(version, decodeKey(value, name))
  }

  if (keys.size === 0) {
    throw new CredentialCryptoError(
      'No credential encryption key is configured. Set CREDENTIAL_ENCRYPTION_KEY ' +
        'to 32 random bytes, base64-encoded (openssl rand -base64 32).',
    )
  }

  return { current: Math.max(...keys.keys()), keys }
}

function decodeKey(value: string, name: string): Buffer {
  const key = Buffer.from(value, 'base64')

  if (key.length !== KEY_BYTES) {
    throw new CredentialCryptoError(
      `${name} must be exactly ${KEY_BYTES} bytes, base64-encoded. Got ${key.length}.`,
    )
  }

  return key
}

export interface SealedCredential {
  /**
   * A plain `Uint8Array`, not a `Buffer`.
   *
   * Prisma's `Bytes` field wants `Uint8Array<ArrayBuffer>`, and Node's `Buffer` is
   * `Uint8Array<ArrayBufferLike>` — which does not satisfy it, because
   * `ArrayBufferLike` includes `SharedArrayBuffer`. Copying into a real
   * `Uint8Array` here means no call site needs a cast to store a credential.
   */
  envelope: Uint8Array<ArrayBuffer>
  keyVersion: number
}

/** Encrypt a credential object. The plaintext never touches disk or a log. */
export function seal(plaintext: unknown, ring: KeyRing): SealedCredential {
  const key = ring.keys.get(ring.current)
  if (!key) throw new CredentialCryptoError(`No key for version ${ring.current}.`)

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const body = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const framed = Buffer.concat([Buffer.from([VERSION, ring.current]), iv, tag, body])

  // Copied into an array backed by a plain ArrayBuffer, rather than handing over
  // the Buffer. See the note on SealedCredential.envelope.
  const envelope = new Uint8Array(framed.byteLength)
  envelope.set(framed)

  return { envelope, keyVersion: ring.current }
}

/**
 * Decrypt a credential.
 *
 * Throws on a tampered envelope, an unknown key version, or a truncated buffer.
 * Deliberately never returns a partial or default value: a caller that gets a
 * credential back must be able to trust it, and "decryption failed so here is an
 * empty object" is how a connector ends up authenticating as nobody and silently
 * doing nothing.
 */
export function open<T = unknown>(sealed: Uint8Array, ring: KeyRing): T {
  const envelope = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength)

  if (envelope.length < HEADER_BYTES + 1) {
    throw new CredentialCryptoError('Credential envelope is truncated.')
  }

  const version = envelope[0]
  if (version !== VERSION) {
    throw new CredentialCryptoError(`Unsupported credential envelope version ${String(version)}.`)
  }

  const keyVersion = envelope[1] ?? 0
  const key = ring.keys.get(keyVersion)
  if (!key) {
    throw new CredentialCryptoError(
      `Credential was encrypted with key version ${keyVersion}, which is not configured. ` +
        `Restore that key before rotating it out.`,
    )
  }

  const iv = envelope.subarray(2, 2 + IV_BYTES)
  const tag = envelope.subarray(2 + IV_BYTES, HEADER_BYTES)
  const body = envelope.subarray(HEADER_BYTES)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  try {
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    return JSON.parse(plaintext) as T
  } catch {
    // The underlying error is deliberately not surfaced: for GCM it distinguishes
    // "tag mismatch" from "bad JSON", which tells an attacker whether their
    // forgery got past authentication.
    throw new CredentialCryptoError(
      'Credential failed authentication — it was encrypted with a different key, or altered.',
    )
  }
}

/** True when this envelope is not on the current key and should be re-sealed. */
export function needsRotation(keyVersion: number, ring: KeyRing): boolean {
  return keyVersion !== ring.current
}

/**
 * Constant-time comparison of two strings.
 *
 * Used for webhook signatures. `===` on a signature leaks its prefix through
 * timing, which over enough requests is enough to forge one — so every secret
 * comparison in this package goes through here.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')

  // Length is not secret, and timingSafeEqual throws on a mismatch. Comparing
  // lengths first is therefore both necessary and harmless.
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
