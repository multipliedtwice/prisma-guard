import type { GuardInput, GuardShape, ShapeOrFn } from '../shared/types.js'
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
  return keys.length === 0 || keys.every((k) => GUARD_SHAPE_KEYS.has(k))
}

function requireBody(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {}

  if (!isPlainObject(body)) {
    throw new ShapeError('Request body must be a plain object')
  }

  return body as Record<string, unknown>
}

function assertNoCallerInBody(body: Record<string, unknown>): void {
  if ('caller' in body) {
    throw new CallerError(
      'Pass caller via the guard(input, caller) argument, not in the request body.',
    )
  }
}

function resolveDynamicShape(
  shapeFn: (ctx: any) => GuardShape,
  ctx: unknown,
  context: string,
): GuardShape {
  if (ctx === undefined) {
    throw new ShapeError(
      `Dynamic ${context} requires a context. Provide contextFn on the extension.`,
    )
  }

  let result: unknown

  try {
    result = shapeFn(ctx)
  } catch (err: any) {
    throw new ShapeError(
      `Dynamic ${context} function threw: ${err.message}`,
      { cause: err },
    )
  }

  if (!isGuardShape(result)) {
    throw new ShapeError(
      `Dynamic ${context} function must return a valid guard shape object`,
    )
  }

  return result
}

function resolveNamedShape(
  input: Record<string, ShapeOrFn<any>>,
  body: Record<string, unknown>,
  contextFn: () => Record<string, unknown>,
  explicitCaller: string | undefined,
): ResolvedShape {
  assertNoCallerInBody(body)

  const caller = explicitCaller
  const keys = Object.keys(input)

  for (const key of keys) {
    if (GUARD_SHAPE_KEYS.has(key)) {
      throw new ShapeError(
        `Caller key "${key}" collides with reserved guard shape key. Rename the caller path.`,
      )
    }
  }

  if (typeof caller !== 'string') {
    if ('default' in input) {
      return resolveShapeEntry(input.default, body, contextFn, 'default')
    }

    throw new CallerError(
      `Missing caller. This guard uses named shape routing with keys: ${keys.map((k) => `"${k}"`).join(', ')}. ` +
        `Provide caller via guard(input, caller).`,
    )
  }

  const matched = matchCallerPattern(keys, caller)

  if (matched) {
    return resolveShapeEntry(input[matched], body, contextFn, matched)
  }

  if ('default' in input) {
    return resolveShapeEntry(input.default, body, contextFn, 'default')
  }

  throw new CallerError(
    `Unknown caller: "${caller}". Allowed: ${keys.map((k) => `"${k}"`).join(', ')}`,
  )
}

function resolveShapeEntry(
  entry: ShapeOrFn<any>,
  body: Record<string, unknown>,
  contextFn: () => Record<string, unknown>,
  matchedKey: string,
): ResolvedShape {
  if (typeof entry === 'function') {
    const ctx = validateContext(contextFn())
    const shape = resolveDynamicShape(entry, ctx, `shape "${matchedKey}"`)

    return {
      shape,
      body,
      matchedKey,
      wasDynamic: true,
    }
  }

  return {
    shape: entry as GuardShape,
    body,
    matchedKey,
    wasDynamic: false,
  }
}

export function resolveShape(
  input: GuardInput,
  rawBody: unknown,
  contextFn: () => Record<string, unknown>,
  explicitCaller: string | undefined,
): ResolvedShape {
  const body = requireBody(rawBody)

  if (typeof input === 'function') {
    const ctx = validateContext(contextFn())
    const shape = resolveDynamicShape(input, ctx, 'shape')

    return {
      shape,
      body,
      matchedKey: '_default',
      wasDynamic: true,
    }
  }

  if (isGuardShape(input)) {
    return {
      shape: input as GuardShape,
      body,
      matchedKey: '_default',
      wasDynamic: false,
    }
  }

  if (!isPlainObject(input)) {
    throw new ShapeError('Guard input must be a shape object or a named map of shapes')
  }

  return resolveNamedShape(
    input as Record<string, ShapeOrFn<any>>,
    body,
    contextFn,
    explicitCaller,
  )
}