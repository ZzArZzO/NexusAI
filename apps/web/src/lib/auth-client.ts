'use client'

import { createAuthClient } from 'better-auth/react'

/**
 * The browser-side auth client.
 *
 * **No `baseURL`, deliberately.** Omitted, the client posts to the origin the page
 * was actually served from; given one, it posts to a URL fixed at build time.
 *
 * This used to read `NEXT_PUBLIC_APP_URL` with a `http://localhost:3200` default,
 * and the consequence was subtle: served on any other origin — the E2E server on
 * :3100, a LAN address, a tunnel — the sign-in form posted cross-origin to a port
 * that might not be listening, and any session cookie was scoped to the wrong
 * origin. The form then navigated to the dashboard, the proxy found no cookie, and
 * it bounced back to sign-in with nothing on screen to explain why.
 *
 * Server-side code still resolves `APP_URL`, because a server has no "current
 * origin" to infer. That is the asymmetry: the browser knows where it is, and the
 * server has to be told.
 */
export const authClient = createAuthClient()

export const { signIn, signUp, signOut, useSession } = authClient
