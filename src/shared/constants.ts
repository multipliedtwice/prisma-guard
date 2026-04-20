export const SHAPE_CONFIG_KEYS = new Set([
  'where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip',
  'distinct', 'having', '_count', '_avg', '_sum', '_min', '_max', 'by',
])

export const GUARD_SHAPE_KEYS = new Set([
  'data', 'create', 'update', ...SHAPE_CONFIG_KEYS,
])

export const COMBINATOR_KEYS = new Set(['AND', 'OR', 'NOT'])

export const TO_MANY_RELATION_OPS = new Set(['some', 'every', 'none'])
export const TO_ONE_RELATION_OPS = new Set(['is', 'isNot'])
export const ALL_RELATION_OPS = new Set([...TO_MANY_RELATION_OPS, ...TO_ONE_RELATION_OPS])

export function toDelegateKey(modelName: string): string {
  return modelName[0].toLowerCase() + modelName.slice(1)
}

const FORCED_MARKER = Symbol.for('prisma-guard.forced')

export function isForcedValue(v: unknown): v is { value: unknown } {
  return v !== null && typeof v === 'object' && (v as any)[FORCED_MARKER] === true
}

export function force<T>(value: T): { value: T } {
  const wrapper: any = { value }
  wrapper[FORCED_MARKER] = true
  return wrapper
}

const UNSUPPORTED_MARKER = Symbol.for('prisma-guard.unsupported')

export function isUnsupportedMarker(v: unknown): boolean {
  return v !== null && typeof v === 'object' && (v as any)[UNSUPPORTED_MARKER] === true
}

export function unsupported(): { __brand: 'unsupported' } {
  const marker: any = {}
  marker[UNSUPPORTED_MARKER] = true
  return marker
}