import type { ZodError } from 'zod'

export class PolicyError extends Error {
  readonly status = 403
  readonly code = 'POLICY_DENIED'
  constructor(message = 'Access denied', options?: ErrorOptions) {
    super(message, options)
    this.name = 'PolicyError'
  }
}

export class ShapeError extends Error {
  readonly status = 400
  readonly code = 'SHAPE_INVALID'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ShapeError'
  }
}

export class CallerError extends Error {
  readonly status = 400
  readonly code = 'CALLER_UNKNOWN'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CallerError'
  }
}

export function formatZodError(err: ZodError): string {
  return err.issues.map(i => {
    const p = i.path.length > 0 ? `${i.path.join('.')}: ` : ''
    return `${p}${i.message}`
  }).join('; ')
}