import { z } from 'zod'

function isJsonSafe(value: unknown): boolean {
  type Entry =
    | { tag: 'visit'; value: unknown }
    | { tag: 'exit'; ref: object }

  const stack: Entry[] = [{ tag: 'visit', value }]
  const ancestors = new Set<object>()

  while (stack.length > 0) {
    const entry = stack.pop()!

    if (entry.tag === 'exit') {
      ancestors.delete(entry.ref)
      continue
    }

    const current = entry.value

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
        if (ancestors.has(current)) return false
        ancestors.add(current)
        stack.push({ tag: 'exit', ref: current })
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            stack.push({ tag: 'visit', value: current[i] })
          }
          continue
        }
        const proto = Object.getPrototypeOf(current)
        if (proto !== Object.prototype && proto !== null) return false
        const values = Object.values(current as Record<string, unknown>)
        for (let i = 0; i < values.length; i++) {
          stack.push({ tag: 'visit', value: values[i] })
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
    z.custom<unknown>(
      (v) =>
        v !== null &&
        typeof v === 'object' &&
        typeof (v as any).toFixed === 'function' &&
        typeof (v as any).toNumber === 'function',
      'Expected Decimal-compatible object',
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
  Json: () => z.unknown().refine(isJsonSafe, 'Value must be JSON-serializable (no undefined, functions, symbols, class instances, NaN, Infinity, or circular references)'),
  Bytes: () => z.union([
    z.string(),
    z.custom<unknown>(v => v instanceof Uint8Array),
  ]),
}