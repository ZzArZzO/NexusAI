import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../generated/client'

/**
 * Runtime client.
 *
 * Connects through the POOLED `DATABASE_URL` (Supabase pooler / PgBouncer) using
 * Prisma 7's driver adapter. Migrations use the DIRECT url instead — see
 * `prisma.config.ts` for why those two differ.
 *
 * Two things this file deliberately gets right:
 *
 * 1. Instantiation is LAZY. `next build` imports every route module to analyse
 *    it, so creating a client at import time would crash any build that has no
 *    DATABASE_URL (CI, Docker image builds). The proxy defers construction until
 *    a query is actually issued.
 * 2. The instance is cached on `globalThis` outside production, so Next.js hot
 *    reload reuses one connection pool instead of opening a new one per edit.
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — cannot connect to the database.')
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log:
      process.env['NODE_ENV'] === 'development'
        ? [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [{ emit: 'stdout', level: 'error' }],
  })
}

const globalForPrisma = globalThis as unknown as { nexusPrisma?: PrismaClient }

export function getPrisma(): PrismaClient {
  globalForPrisma.nexusPrisma ??= createPrismaClient()
  return globalForPrisma.nexusPrisma
}

/** Ergonomic handle: `prisma.workspace.findMany()` connects on first use. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getPrisma(), property, receiver) as unknown
  },
})

export type { PrismaClient }
