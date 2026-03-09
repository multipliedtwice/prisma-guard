import { PolicyError } from '../shared/errors.js'
import { isPlainObject } from '../shared/is-plain-object.js'

export function requireContext(ctx: unknown, label: string): asserts ctx {
  if (ctx === undefined || ctx === null) {
    throw new PolicyError(`Context required for ${label}`)
  }
}

export function validateContext(ctx: unknown): Record<string, unknown> {
  if (ctx === null || ctx === undefined) {
    throw new PolicyError(
      `guard.extension() context function must return a plain object, got ${String(ctx)}`,
    )
  }
  if (!isPlainObject(ctx)) {
    throw new PolicyError(
      `guard.extension() context function must return a plain object, got ${Array.isArray(ctx) ? 'array' : typeof ctx}`,
    )
  }
  return ctx
}