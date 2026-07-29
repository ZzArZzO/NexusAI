import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'
import type { NextConfig } from 'next'

// Next only reads .env from the app directory, but this monorepo keeps one
// canonical .env at the root. next.config.ts is evaluated before the build
// reads process.env, so loading it here covers both server code and the
// compile-time inlining of NEXT_PUBLIC_* values.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * Self-contained server bundle for the Docker image, opt-in via
   * BUILD_STANDALONE=1 (set in infra/docker/Dockerfile.web).
   *
   * Not always-on, because it is actively harmful during development: standalone
   * copies the workspace into apps/web/.next/standalone, pnpm's symlink then
   * exposes that copy *inside* node_modules, and Turbopack walks into it and
   * fails to resolve workspace packages against the stale tree.
   */
  ...(process.env['BUILD_STANDALONE'] === '1'
    ? {
        output: 'standalone' as const,
        // In a monorepo, tracing must start at the workspace root or shared
        // packages are omitted from the standalone output.
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
      }
    : {}),

  /**
   * Cache Components is deliberately OFF.
   *
   * It requires every uncached read to sit inside a `<Suspense>` boundary so a
   * static shell can be prerendered around it. That is a real win for pages with
   * mixed cacheability — a marketing page with a live price, say.
   *
   * This application is not that. Every route is behind authentication, every
   * panel is per-operator data, and the database is on the same machine. There is
   * no meaningful static shell to prerender: the layout itself reads the session
   * and the departments' live status. Enabling it would buy a skeleton of chrome
   * in exchange for restructuring every layout and page around boundaries that
   * exist for no other reason.
   *
   * Worth revisiting if this is ever hosted away from its database, where the
   * latency that shells hide actually appears.
   */
  cacheComponents: false,

  /** Workspace packages ship TypeScript source, so Next compiles them itself. */
  transpilePackages: ['@nexusai/ui', '@nexusai/core', '@nexusai/db'],

  typedRoutes: true,

  serverExternalPackages: ['@prisma/adapter-pg', 'pg', 'pino', 'pino-pretty'],

  headers: () =>
    Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]),
}

export default config
