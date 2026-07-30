/**
 * The one HTTP client every connector uses.
 *
 * Connectors do not call `fetch` directly, for three reasons that each cost a
 * production incident to learn:
 *
 *  - **A request without a timeout hangs forever.** One stuck call inside an
 *    Inngest step holds a concurrency slot until the function times out, and the
 *    symptom is "the company stopped working", not "GitHub was slow".
 *  - **A non-2xx response must not look like data.** `fetch` resolves on a 500,
 *    so a connector that forgets to check `ok` returns an error body as if it were
 *    a result, and an agent reports it as fact.
 *  - **Error bodies leak.** Providers echo request parameters back in errors, and
 *    request parameters include tokens.
 */

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_ERROR_BODY = 500

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly detail: string,
  ) {
    super(`${status} from ${url}: ${detail}`)
    this.name = 'HttpError'
  }

  /** True when retrying could plausibly succeed. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500
  }

  /** True when the credential is the problem, so the UI can say "reauthorise". */
  get authFailure(): boolean {
    return this.status === 401 || this.status === 403
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  /** Sent as a query string. Undefined values are dropped rather than sent as "undefined". */
  query?: Record<string, string | number | boolean | undefined>
}

export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const target = new URL(url)

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) target.searchParams.set(key, String(value))
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(target, {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    })

    if (!response.ok) {
      // Truncated, and the URL logged is the one *we* built — never the response
      // body verbatim beyond a short excerpt, because providers echo parameters.
      const detail = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY)
      throw new HttpError(response.status, `${target.origin}${target.pathname}`, detail)
    }

    if (response.status === 204) return undefined as T

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof HttpError) throw error

    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(
        408,
        `${target.origin}${target.pathname}`,
        `No response within ${String(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)}ms.`,
      )
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}
