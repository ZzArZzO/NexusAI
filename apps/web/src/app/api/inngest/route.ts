import { functions, inngest } from '@nexusai/jobs'
import { serve } from 'inngest/next'

/**
 * Where Inngest reaches the application.
 *
 * It calls this endpoint to discover functions and to execute each step, so every
 * durable workflow in the company runs through here. The route is outside the
 * session-protected area because Inngest authenticates with a signing key rather
 * than a cookie — see the note in proxy.ts.
 *
 * ## serveOrigin
 *
 * This is the address the SDK *advertises to Inngest*, not the address it listens
 * on. It matters because Inngest runs in a container: registering as
 * `localhost:3200` makes Inngest call itself, and every run fails with "Unable to
 * reach SDK URL" — which looks like a broken workflow and is actually a broken
 * hostname. `host.docker.internal` is how a container reaches its host.
 *
 * In a deployment where both sides share a network, set INNGEST_SERVE_ORIGIN to
 * the app's real origin instead.
 */
const serveOrigin =
  process.env['INNGEST_SERVE_ORIGIN'] ??
  (process.env.NODE_ENV === 'development' ? 'http://host.docker.internal:3200' : undefined)

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  ...(serveOrigin ? { serveOrigin } : {}),
})

/**
 * One step gets this long. Steps are the unit of retry, so the ceiling only has
 * to cover the slowest single step — an agent run — not a whole workflow, which
 * may legitimately span days waiting on an approval.
 */
export const maxDuration = 300
