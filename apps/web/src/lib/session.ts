import { cache } from 'react'

import { UnauthenticatedError, userActor, type UserActor } from '@nexusai/core'
import { prisma } from '@nexusai/db'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from './auth'

/**
 * Turning a session cookie into a Policy actor.
 *
 * Everything server-side that needs to know "who is this and what may they do"
 * goes through here, so there is exactly one place where a session becomes
 * authority. `cache()` deduplicates it within a single render pass — a page with
 * eight server components resolves the actor once, not eight times.
 */

export interface SessionContext {
  actor: UserActor
  user: { id: string; name: string; email: string; image: string | null }
  workspace: { id: string; slug: string; name: string; timezone: string; currency: string }
}

/**
 * Resolve the current actor, or null when signed out.
 *
 * Note that a valid session with no membership resolves to null rather than to
 * an actor with no permissions. A user who exists but belongs to nothing is not
 * a weaker user — they are not a user of this workspace at all, and treating
 * those cases the same would let a stale account linger with an empty but real
 * identity.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null

  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id },
    include: {
      workspace: {
        select: { id: true, slug: true, name: true, timezone: true, currency: true },
      },
      role: {
        select: {
          key: true,
          permissions: { select: { permission: { select: { resource: true, action: true } } } },
        },
      },
    },
  })

  if (!membership) return null

  const permissions = membership.role.permissions.map(
    ({ permission }) => `${permission.resource}:${permission.action}`,
  )

  return {
    actor: userActor({
      id: session.user.id,
      workspaceId: membership.workspace.id,
      roleKey: membership.role.key,
      permissions,
    }),
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    workspace: membership.workspace,
  }
})

/**
 * For server components and pages: redirect to sign-in rather than throwing,
 * because a 500 is the wrong response to "not signed in yet".
 */
export async function requireSession(): Promise<SessionContext> {
  const context = await getSessionContext()
  if (!context) redirect('/sign-in')
  return context
}

/**
 * For route handlers and server actions: throw, so the error boundary turns it
 * into a 401 rather than an HTML redirect a fetch caller cannot follow.
 */
export async function requireActor(): Promise<SessionContext> {
  const context = await getSessionContext()
  if (!context) throw new UnauthenticatedError()
  return context
}

/** True before the first account exists — the only moment sign-up is open. */
export async function isRegistrationOpen(): Promise<boolean> {
  return (await prisma.user.count()) === 0
}
