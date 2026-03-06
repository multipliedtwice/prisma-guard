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
  constructor(caller: string, options?: ErrorOptions) {
    super(`Unknown caller: ${caller}`, options)
    this.name = 'CallerError'
  }
}