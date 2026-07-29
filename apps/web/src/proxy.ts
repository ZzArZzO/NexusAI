import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

import { COOKIE_PREFIX } from '@/lib/auth-shared'

/**
 * Route protection.
 *
 * Named `proxy` rather than `middleware`: Next 16 renamed the convention.
 *
 * This is an *optimisation*, not the security boundary. It only checks whether a
 * session cookie is present — it does not validate it, because this runs on
 * every request and a database round trip here would tax every navigation.
 *
 * The real check is `requireSession()` / `requireActor()` in the page or handler,
 * which resolves the session properly and applies the Policy layer. A forged
 * cookie gets past this and is then rejected there.
 */

const PUBLIC_PATHS = ['/sign-in', '/sign-up', '/api/auth', '/api/health']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  // The prefix must match `advanced.cookiePrefix` in auth.ts, which is why both
  // read it from one constant rather than repeating the string.
  if (getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX })) {
    return NextResponse.next()
  }

  const signIn = new URL('/sign-in', request.url)
  // Preserve where they were going, so signing in lands them there.
  if (pathname !== '/') signIn.searchParams.set('next', pathname)

  return NextResponse.redirect(signIn)
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
