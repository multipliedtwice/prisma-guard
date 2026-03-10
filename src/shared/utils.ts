import { z } from 'zod'

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function schemaProducesValueForUndefined(schema: z.ZodTypeAny): boolean {
  const result = schema.safeParse(undefined)
  return result.success && result.data !== undefined
}

export function isZodSchema(value: unknown): value is z.ZodTypeAny {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.parse === 'function' && typeof v.optional === 'function'
}