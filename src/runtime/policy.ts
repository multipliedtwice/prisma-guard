import { PolicyError } from '../shared/errors.js'

export function requireContext(ctx: unknown, label: string): asserts ctx {
  if (ctx === undefined || ctx === null) {
    throw new PolicyError(`Context required for ${label}`)
  }
}