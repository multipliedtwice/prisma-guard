import type { GuardShape, GuardShapeOrFn, GuardInput } from '../shared/types.js'
import { ShapeError, CallerError } from '../shared/errors.js'
import { GUARD_SHAPE_KEYS } from '../shared/constants.js'
import { matchCallerPattern } from '../shared/match-caller.js'
import { isPlainObject } from '../shared/utils.js'
import { validateContext } from './policy.js'

export interface ResolvedShape {
  shape: GuardShape
  body: Record<string, unknown>
  matchedKey: string
  wasDynamic: boolean
}

function isGuardShape(obj: unknown): obj is GuardShape {
  if (!isPlainObject(obj)) return false
  const keys = Object.keys(obj)
  return keys.length === 0 || keys.every(k => GUARD_SHAPE_KEYS.has(k))
}

function isSingleShape(input: GuardInput): input is GuardShapeOrFn {
  return typeof input === 'function' || isGuardShape(input)
}

function requireBody(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) throw new ShapeError('Request body must be an object')
  return body
}

export function resolveDynamicShape(
  fn: (ctx: any) => GuardShape,
  contextFn: () => Record<string, unknown>,
): GuardShape {
  const ctx = validateContext(contextFn())
  let result: unknown
  try {
    result = fn(ctx)
  } catch (err: any) {
    throw new ShapeError(
      `Dynamic shape function threw: ${err.message}`,
      { cause: err },
    )
  }
  if (!isPlainObject(result)) {
    throw new ShapeError('Dynamic shape function must return a plain object')
  }
  return result as GuardShape
}

export function resolveShape(
  input: GuardInput,
  body: unknown,
  contextFn: () => Record<string, unknown>,
  caller: string | undefined,
): ResolvedShape {
  if (isSingleShape(input)) {
    const wasDynamic = typeof input === 'function'
    const shape = wasDynamic
      ? resolveDynamicShape(input as (ctx: any) => GuardShape, contextFn)
      : input as GuardShape
    const parsed = body === undefined || body === null
      ? {}
      : requireBody(body)
    return { shape, body: parsed, matchedKey: '_default', wasDynamic }
  }

  const namedMap = input as Record<string, GuardShapeOrFn>

  for (const key of Object.keys(namedMap)) {
    if (GUARD_SHAPE_KEYS.has(key)) {
      throw new ShapeError(
        `Caller key "${key}" collides with reserved shape config key. Rename the caller path.`,
      )
    }
    const val = namedMap[key]
    if (typeof val !== 'function' && !isGuardShape(val)) {
      throw new ShapeError(
        `Named shape value for "${key}" must be a guard shape object or function`,
      )
    }
  }

  const parsed = body === undefined || body === null
    ? {}
    : requireBody(body)

  if ('caller' in parsed) {
    throw new CallerError(
      'Pass caller as second argument to .guard() or via context function, not in the request body.',
    )
  }

  if (typeof caller !== 'string') {
    const patterns = Object.keys(namedMap)
    throw new CallerError(
      `Missing caller. This guard uses named shape routing with keys: ${patterns.map(k => `"${k}"`).join(', ')}. ` +
      `Provide caller as second argument to .guard() or set "caller" in the context function.`,
    )
  }

  const patterns = Object.keys(namedMap)
  const matched = matchCallerPattern(patterns, caller)
  if (!matched) {
    throw new CallerError(
      `Unknown caller: "${caller}". Allowed: ${patterns.map(k => `"${k}"`).join(', ')}`,
    )
  }

  const shapeOrFn = namedMap[matched]
  const wasDynamic = typeof shapeOrFn === 'function'
  const shape = wasDynamic
    ? resolveDynamicShape(shapeOrFn as (ctx: any) => GuardShape, contextFn)
    : shapeOrFn as GuardShape

  return { shape, body: parsed, matchedKey: matched, wasDynamic }
}