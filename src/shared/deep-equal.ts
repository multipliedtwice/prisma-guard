import { isPlainObject } from './utils.js'

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a === undefined || b === undefined) return false

  const ta = typeof a
  const tb = typeof b
  if (ta !== tb) return false

  if (ta === 'bigint') return a === b
  if (ta !== 'object') return false

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }
  if (a instanceof Date || b instanceof Date) return false

  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags
  }
  if (a instanceof RegExp || b instanceof RegExp) return false

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (Array.isArray(b)) return false

  if (!isPlainObject(a) || !isPlainObject(b)) return false

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    if (!(key in b)) return false
    if (!deepEqual(a[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}