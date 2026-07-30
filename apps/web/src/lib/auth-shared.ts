/**
 * Values shared between the auth instance and the proxy.
 *
 * The cookie prefix lives here because it is needed in two places that cannot
 * import each other: `auth.ts` sets it, and `proxy.ts` reads the cookie by name.
 * When those two drifted, every authenticated request was redirected to sign-in
 * while the session itself was perfectly valid — a failure that looks like
 * broken auth and is actually a mismatched string.
 */
export const COOKIE_PREFIX = 'nexus'

/**
 * Whether the session cookie carries the `Secure` attribute and `__Secure-` name
 * prefix.
 *
 * Derived from the scheme rather than from NODE_ENV, because a `__Secure-` cookie
 * is only accepted by a browser over TLS — and this deployment runs in production
 * mode behind plain HTTP on localhost. Getting this wrong issues a cookie the
 * browser silently discards, which presents as "sign-in does nothing".
 *
 * Shared for the same reason as the prefix: `auth.ts` decides the cookie's name
 * and `proxy.ts` has to look for that exact name.
 */
export const USE_SECURE_COOKIES = (process.env['APP_URL'] ?? '').startsWith('https://')
