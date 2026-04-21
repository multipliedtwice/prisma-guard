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

export function coerceToArray(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  const keys = Object.keys(value as Record<string, unknown>)
  if (keys.length === 0) return value
  const allNumeric = keys.every((k) => /^\d+$/.test(k))
  if (!allNumeric) return value
  const indices = keys.map(Number).sort((a, b) => a - b)
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) return value
  }
  const obj = value as Record<string, unknown>
  const result: unknown[] = new Array(indices.length)
  for (let i = 0; i < indices.length; i++) {
    result[i] = obj[String(i)]
  }
  return result
}