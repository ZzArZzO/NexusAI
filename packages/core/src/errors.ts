/**
 * Typed error hierarchy. Every layer throws these rather than bare `Error`,
 * so the API boundary can map them to status codes without string matching.
 */
export abstract class NexusError extends Error {
  abstract readonly code: string
  /** HTTP status to surface at the API boundary. */
  abstract readonly status: number
  /** Safe to show the user; internal detail stays in `cause`/logs. */
  readonly userMessage: string

  constructor(message: string, options?: { userMessage?: string; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.userMessage = options?.userMessage ?? message
  }
}

export class ValidationError extends NexusError {
  readonly code = 'VALIDATION_ERROR'
  readonly status = 400
}

export class UnauthenticatedError extends NexusError {
  readonly code = 'UNAUTHENTICATED'
  readonly status = 401

  constructor(message = 'Authentication required.') {
    super(message)
  }
}

export class ForbiddenError extends NexusError {
  readonly code = 'FORBIDDEN'
  readonly status = 403

  constructor(
    readonly permission: string,
    message = `Missing permission: ${permission}`,
  ) {
    super(message, { userMessage: 'You do not have permission to do that.' })
  }
}

export class NotFoundError extends NexusError {
  readonly code = 'NOT_FOUND'
  readonly status = 404

  constructor(resource: string, id?: string) {
    super(id === undefined ? `${resource} not found` : `${resource} not found: ${id}`)
  }
}

export class ConflictError extends NexusError {
  readonly code = 'CONFLICT'
  readonly status = 409
}

/** A tool was invoked whose risk tier demands approval that was never granted. */
export class ApprovalRequiredError extends NexusError {
  readonly code = 'APPROVAL_REQUIRED'
  readonly status = 423

  constructor(
    readonly toolName: string,
    readonly approvalId: string,
  ) {
    super(`Tool "${toolName}" requires approval ${approvalId} before it can execute.`, {
      userMessage: 'This action is waiting for your approval.',
    })
  }
}

/** A department attempted to delegate outside its permitted edges of the org chart. */
export class DelegationNotPermittedError extends NexusError {
  readonly code = 'DELEGATION_NOT_PERMITTED'
  readonly status = 403

  constructor(from: string, to: string) {
    super(`${from} may not delegate to ${to}.`)
  }
}

export class ExternalServiceError extends NexusError {
  readonly code = 'EXTERNAL_SERVICE_ERROR'
  readonly status = 502

  constructor(
    readonly service: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${service}: ${message}`, {
      userMessage: `${service} is unavailable right now.`,
      ...options,
    })
  }
}

export function isNexusError(error: unknown): error is NexusError {
  return error instanceof NexusError
}

/** Narrow an unknown thrown value to something loggable without losing detail. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return JSON.stringify(error)
}
