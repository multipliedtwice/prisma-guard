export function deepClone<T>(value: T): T {
  if (value === null || value === undefined) return value
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
      return value
    case 'object': {
      if (value instanceof Date) return new Date(value.getTime()) as T
      if (value instanceof Uint8Array) return value.slice() as T
      if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T
      if (Array.isArray(value)) return value.map(deepClone) as T
      const proto = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) return value
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = deepClone(v)
      }
      return result as T
    }
    default:
      return value
  }
}