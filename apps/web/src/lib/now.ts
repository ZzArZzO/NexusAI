import 'server-only'

/**
 * Read the clock inside a Server Component.
 *
 * The React Compiler's purity rule forbids calling `Date.now()` during render,
 * and it is right to: in a client component an unstable value produces output
 * that changes on any incidental re-render.
 *
 * Server Components render once per request, so reading the clock there is both
 * necessary and safe — "what is overdue right now" has no other source. Rather
 * than scatter suppressions across every page that needs the time, the exception
 * is made once, here, where it can be explained. `server-only` makes it a build
 * error if this ever gets imported into client code, where the rule genuinely
 * applies.
 */
export function serverNow(): number {
  return Date.now()
}

export function serverDate(): Date {
  return new Date(serverNow())
}
