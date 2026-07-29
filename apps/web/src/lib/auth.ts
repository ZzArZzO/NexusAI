import { getPrisma } from '@nexusai/db'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'

import { COOKIE_PREFIX } from './auth-shared'

/**
 * Authentication.
 *
 * Email and password rather than a social provider, because this deployment is
 * local and single-operator: an OAuth round trip to a public identity provider
 * would be the only part of the system that leaves the machine.
 *
 * The important rule is in `signUpGuard` below — registration closes as soon as
 * the first account exists.
 */

const SESSION_DAYS = 30

function requiredSecret(): string {
  const secret = process.env['AUTH_SECRET']

  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET must be set to at least 32 characters. Generate one with:\n' +
        '  openssl rand -base64 32',
    )
  }

  return secret
}

export const auth = betterAuth({
  database: prismaAdapter(getPrisma(), { provider: 'postgresql' }),
  secret: requiredSecret(),
  baseURL: process.env['APP_URL'] ?? 'http://localhost:3200',

  emailAndPassword: {
    enabled: true,
    // No verification email: there is no mail server, and a local single-user
    // deployment gains nothing from proving the operator owns their own inbox.
    requireEmailVerification: false,
    minPasswordLength: 12,
  },

  session: {
    expiresIn: SESSION_DAYS * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    cookieCache: {
      // Avoids a database round trip on every request. Short enough that a
      // revoked session stops working within a minute.
      enabled: true,
      maxAge: 60,
    },
  },

  advanced: {
    cookiePrefix: COOKIE_PREFIX,
    // Next augments ProcessEnv with a typed NODE_ENV, so this is a known
    // property rather than an index signature access.
    useSecureCookies: process.env.NODE_ENV === 'production',
  },

  hooks: {
    /**
     * Close registration after the first account.
     *
     * This is the whole access-control story for a locally-hosted deployment.
     * Without it, anything that can reach the port can create an account and
     * hold the operator's business data — and "it's only on my LAN" is exactly
     * the assumption that stops being true the first time a port is forwarded.
     *
     * Additional people are added by creating a Membership deliberately, not by
     * self-service signup.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (!ctx.path.startsWith('/sign-up')) return

      const existing = await getPrisma().user.count()
      if (existing > 0) {
        throw new APIError('FORBIDDEN', {
          message:
            'Registration is closed. This workspace already has an operator. ' +
            'Add further people by inviting them rather than signing up.',
        })
      }
    }),
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * A user without a membership can authenticate but has no workspace and
         * therefore no permissions — `getSessionContext` resolves them to null.
         * Creating the membership here means the first account is usable
         * immediately rather than stranded on a blank screen.
         *
         * The seed must have run first, which is stated in the setup steps and
         * checked loudly here rather than failing later with a confusing empty UI.
         */
        after: async (user) => {
          const prisma = getPrisma()

          const workspace = await prisma.workspace.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })

          if (!workspace) {
            throw new Error(
              'No workspace exists. Run `pnpm db:seed` before creating the first account.',
            )
          }

          const ownerRole = await prisma.role.findUnique({
            where: { workspaceId_key: { workspaceId: workspace.id, key: 'owner' } },
            select: { id: true },
          })

          if (!ownerRole) {
            throw new Error(
              'The owner role is missing. Run `pnpm db:seed` to install the permission matrix.',
            )
          }

          await prisma.membership.create({
            data: { workspaceId: workspace.id, userId: user.id, roleId: ownerRole.id },
          })

          await prisma.auditLog.create({
            data: {
              workspaceId: workspace.id,
              userId: user.id,
              action: 'created',
              resource: 'user',
              resourceId: user.id,
              metadata: { role: 'owner', reason: 'first account' },
            },
          })
        },
      },
    },
  },

  // Must be last: it forwards Set-Cookie headers into the Next.js response.
  plugins: [nextCookies()],
})

export type Auth = typeof auth
