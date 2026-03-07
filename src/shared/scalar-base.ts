import { z } from 'zod'

/**
 * Validates that a value is JSON-serializable without using recursion.
 * Uses an iterative stack-based traversal to avoid stack overflow on
 * deeply nested client-provided Json field values.
 *
 * Rejects: undefined, functions, symbols, class instances (including Date),
 * NaN, Infinity.
 */
function isJsonSafe(value: unknown): boolean {
  const stack: unknown[] = [value]

  while (stack.length > 0) {
    const current = stack.pop()

    if (current === undefined) return false
    if (current === null) continue

    switch (typeof current) {
      case 'string':
      case 'boolean':
        continue
      case 'number':
        if (!Number.isFinite(current)) return false
        continue
      case 'object': {
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            stack.push(current[i])
          }
          continue
        }
        const proto = Object.getPrototypeOf(current)
        if (proto !== Object.prototype && proto !== null) return false
        const values = Object.values(current as Record<string, unknown>)
        for (let i = 0; i < values.length; i++) {
          stack.push(values[i])
        }
        continue
      }
      default:
        return false
    }
  }

  return true
}

export const SCALAR_BASE: Record<string, () => z.ZodTypeAny> = {
  String: () => z.string(),
  Int: () => z.number().int(),
  Float: () => z.number(),
  Decimal: () => z.union([
    z.number(),
    z.string().refine(
      (s) => /^-?(\d+\.?\d*|\.\d+)([eE]-?\d+)?$/.test(s),
      'Invalid decimal string',
    ),
  ]),
  BigInt: () => z.union([
    z.bigint(),
    z.number().int()
      .refine(
        v => v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER,
        'Number exceeds safe integer range for BigInt conversion',
      )
      .transform(v => BigInt(v)),
    z.string().regex(/^-?\d+$/).transform(v => BigInt(v)),
  ]),
  Boolean: () => z.boolean(),
  DateTime: () => z.union([
    z.date(),
    z.string().datetime({ offset: true }),
    z.string().datetime(),
  ]).pipe(z.coerce.date()),
  Json: () => z.unknown().refine(isJsonSafe, 'Value must be JSON-serializable (no undefined, functions, symbols, class instances, NaN, or Infinity)'),
  Bytes: () => z.union([
    z.string(),
    z.custom<unknown>(v => v instanceof Uint8Array),
  ]),
}