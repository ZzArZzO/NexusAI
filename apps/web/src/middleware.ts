import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Route protection.
 *
 * This is an *optimisation*, not the security boundary. It only checks whether a
 * session cookie is present — it does not validate it, because middleware runs
 * on every request and a database round trip here would tax every navigation.
 *
 * The real check is `requireSession()` / `requireActor()` in the page or handler,
 * which resolves the session properly and applies the Policy layer. A forged
 * cookie gets past this and is then rejected there.
 */

const PUBLIC_PATHS = ['/sign-in', '/sign-up', '/api/auth', '/api/health']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  if (getSessionCookie(request)) {
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
