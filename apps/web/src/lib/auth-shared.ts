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
