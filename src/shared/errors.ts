import type { ZodError, ZodIssue } from 'zod'

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

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  const code = issue.code as string

  if (code === 'invalid_union') {
    const unionErrors = (issue as any).unionErrors as ZodError[] | undefined
    if (unionErrors && unionErrors.length > 0) {
      const branches = unionErrors
        .map((ue, i) => {
          const nested = ue.issues.map(formatIssue).join(', ')
          return `branch ${i + 1}: [${nested}]`
        })
        .join(' | ')
      return `${path}No matching variant (${branches})`
    }
    return `${path}No matching variant`
  }

  if (issue.code === 'unrecognized_keys') {
    const keys = (issue as any).keys as string[] | undefined
    if (keys && keys.length > 0) {
      return `${path}Unrecognized key(s): ${keys.join(', ')}`
    }
  }

  if (issue.code === 'invalid_type') {
    const expected = (issue as any).expected
    const received = (issue as any).received
    if (expected && received) {
      return `${path}Expected ${expected}, received ${received}`
    }
  }

  if (code === 'invalid_enum_value') {
    const options = (issue as any).options
    if (options) {
      return `${path}Invalid value. Expected one of: ${options.join(', ')}`
    }
  }

  if (code === 'too_small') {
    const minimum = (issue as any).minimum
    const type = (issue as any).type
    if (type === 'string' && minimum !== undefined) {
      return `${path}String must contain at least ${minimum} character(s)`
    }
    if (type === 'array' && minimum !== undefined) {
      return `${path}Array must contain at least ${minimum} element(s)`
    }
    if (type === 'number' && minimum !== undefined) {
      return `${path}Number must be >= ${minimum}`
    }
    return `${path}${issue.message}`
  }

  if (code === 'too_big') {
    const maximum = (issue as any).maximum
    const type = (issue as any).type
    if (type === 'string' && maximum !== undefined) {
      return `${path}String must contain at most ${maximum} character(s)`
    }
    if (type === 'array' && maximum !== undefined) {
      return `${path}Array must contain at most ${maximum} element(s)`
    }
    if (type === 'number' && maximum !== undefined) {
      return `${path}Number must be <= ${maximum}`
    }
    return `${path}${issue.message}`
  }

  if (code === 'invalid_format') {
    const format = (issue as any).format
    if (format) {
      return `${path}Invalid ${format} format`
    }
  }

  if (code === 'invalid_value') {
    const values = (issue as any).values
    if (values) {
      return `${path}Invalid value. Expected one of: ${values.join(', ')}`
    }
  }

  return `${path}${issue.message}`
}

export function formatZodError(err: ZodError): string {
  return err.issues.map(formatIssue).join('; ')
}

export function wrapParseError(err: unknown, context: string): never {
  if (err instanceof ShapeError) {
    throw new ShapeError(`${context}: ${err.message}`, { cause: err })
  }
  if (err && typeof err === 'object' && 'issues' in err) {
    throw new ShapeError(`${context}: ${formatZodError(err as ZodError)}`, { cause: err })
  }
  throw err
}