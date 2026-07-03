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
    const raw = issue as unknown as {
      errors?: ZodIssue[][]
      unionErrors?: ZodError[]
    }

    let branchIssues: ZodIssue[][] | null = null

    if (Array.isArray(raw.errors) && raw.errors.length > 0) {
      branchIssues = raw.errors
    } else if (Array.isArray(raw.unionErrors) && raw.unionErrors.length > 0) {
      branchIssues = raw.unionErrors.map((ue) => ue.issues)
    }

    if (branchIssues) {
      const branches = branchIssues
        .map((issues, i) => {
          const nested = issues.map(formatIssue).join(', ')
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
    if (expected) {
      return `${path}Expected ${expected}`
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
    const origin = (issue as any).origin ?? (issue as any).type
    if (origin === 'string' && minimum !== undefined) {
      return `${path}String must contain at least ${minimum} character(s)`
    }
    if (origin === 'array' && minimum !== undefined) {
      return `${path}Array must contain at least ${minimum} element(s)`
    }
    if (origin === 'number' && minimum !== undefined) {
      return `${path}Number must be >= ${minimum}`
    }
    return `${path}${issue.message}`
  }

  if (code === 'too_big') {
    const maximum = (issue as any).maximum
    const origin = (issue as any).origin ?? (issue as any).type
    if (origin === 'string' && maximum !== undefined) {
      return `${path}String must contain at most ${maximum} character(s)`
    }
    if (origin === 'array' && maximum !== undefined) {
      return `${path}Array must contain at most ${maximum} element(s)`
    }
    if (origin === 'number' && maximum !== undefined) {
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

function isZodErrorLike(err: unknown): err is ZodError {
  return !!err && typeof err === 'object' && 'issues' in err
}

export function wrapZod(err: unknown, context: string): never {
  if (err instanceof ShapeError) {
    throw new ShapeError(`${context}: ${err.message}`, { cause: err })
  }
  if (isZodErrorLike(err)) {
    throw new ShapeError(`${context}: ${formatZodError(err)}`, { cause: err })
  }
  throw err
}

export function wrapParseError(err: unknown, context: string): never {
  return wrapZod(err, context)
}

export function toShapeError(err: unknown, prefix = 'Validation failed'): Error {
  if (isZodErrorLike(err)) {
    return new ShapeError(`${prefix}: ${formatZodError(err)}`, { cause: err })
  }
  return err as Error
}