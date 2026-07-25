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
      if (value instanceof Uint8Array) {
        // Buffer.prototype.slice returns a view over shared memory (unlike
        // Uint8Array.prototype.slice, which copies). Force a real copy so the
        // clone never aliases the source's backing buffer.
        if (
          typeof Buffer !== 'undefined' &&
          (Buffer as { isBuffer?: (v: unknown) => boolean }).isBuffer?.(value)
        ) {
          return Buffer.from(value) as T
        }
        return value.slice() as T
      }
      if (value instanceof RegExp)
        return new RegExp(value.source, value.flags) as T
      if (Array.isArray(value)) return value.map(deepClone) as T
      const proto = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) return value
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const cloned = deepClone(v)
        if (k === '__proto__') {
          // Assigning result["__proto__"] would invoke the prototype setter
          // instead of creating an own property, silently dropping the data.
          Object.defineProperty(result, k, {
            value: cloned,
            enumerable: true,
            writable: true,
            configurable: true,
          })
        } else {
          result[k] = cloned
        }
      }
      return result as T
    }
    default:
      return value
  }
}
