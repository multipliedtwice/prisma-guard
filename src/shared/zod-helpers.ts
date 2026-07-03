import { z } from 'zod'
import { coerceToArray, isPlainObject } from './utils.js'
import { ShapeError } from './errors.js'
import { NestedArgs } from './types.js'

export function strictObjectRequiringOne(
  shape: Record<string, z.ZodTypeAny>,
  message: string,
): z.ZodTypeAny {
  const keys = Object.keys(shape)
  return z
    .object(shape)
    .strict()
    .refine(
      (v) => keys.some((k) => (v as Record<string, unknown>)[k] !== undefined),
      { message },
    )
}

export function singleOrArraySchema(single: z.ZodTypeAny): z.ZodTypeAny {
  return z.union([
    single,
    z.preprocess(coerceToArray, z.array(single).min(1)),
  ])
}

export function optionalOneOrMany(single: z.ZodTypeAny): z.ZodTypeAny {
  return z
    .union([single, z.preprocess(coerceToArray, z.array(single))])
    .optional()
}

export function wrapRelationOp(
  isList: boolean,
  single: z.ZodTypeAny,
): z.ZodTypeAny {
  if (!isList) return single.optional()
  return optionalOneOrMany(single)
}

export function buildLiteralTrueSchema(
  fieldNames: string[],
  message: string,
  validate?: (fieldName: string) => void,
): z.ZodTypeAny {
  const fieldSchemas: Record<string, z.ZodTypeAny> = {}

  for (const fieldName of fieldNames) {
    if (validate) validate(fieldName)
    fieldSchemas[fieldName] = z.literal(true).optional()
  }

  return strictObjectRequiringOne(fieldSchemas, message).optional()
}

export function requireConfigTrue(
  config: Record<string, unknown>,
  context: string,
): void {
  for (const [key, value] of Object.entries(config)) {
    if (value !== true) {
      throw new ShapeError(
        `Config value for "${key}" in ${context} must be true, got ${typeof value}`,
      )
    }
  }
}

export function requirePlainObjectConfig(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ShapeError(message)
  }
  return value as Record<string, unknown>
}

export function assertAllowedKeys(
  value: Record<string, unknown> | NestedArgs,
  allowed: Set<string>,
  makeError: (key: string) => string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ShapeError(makeError(key))
    }
  }
}