import { Inngest } from 'inngest'

/**
 * The Inngest client.
 *
 * Self-hosted, backed by the same Postgres and Redis as everything else. The dev
 * server's in-memory state is not durable enough to build approval gates on —
 * a workflow parked for three days waiting on a human must survive a restart, or
 * the gate is theatre.
 *
 * Event schemas are not registered here: in Inngest 4 each event carries its own
 * schema via `eventType`, so the trigger declaration and the payload type are the
 * same object and cannot drift apart.
 */
export const inngest = new Inngest({
  id: 'nexusai',

  /**
   * Retries apply to a *step*, not the whole function. A failed tool call is
   * retried without re-running the steps before it — the property that makes
   * "never send the email twice" achievable rather than aspirational.
   */
  retries: 3,

  ...(process.env['INNGEST_BASE_URL'] ? { baseUrl: process.env['INNGEST_BASE_URL'] } : {}),
  ...(process.env['INNGEST_EVENT_KEY'] ? { eventKey: process.env['INNGEST_EVENT_KEY'] } : {}),
})

export type NexusInngest = typeof inngest
