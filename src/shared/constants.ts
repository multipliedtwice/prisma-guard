export const SHAPE_CONFIG_KEYS = new Set([
  'where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip',
  'distinct', 'having', '_count', '_avg', '_sum', '_min', '_max', 'by',
])

export const GUARD_SHAPE_KEYS = new Set([
  'data', ...SHAPE_CONFIG_KEYS,
])

export const COMBINATOR_KEYS = new Set(['AND', 'OR', 'NOT'])

export const TO_MANY_RELATION_OPS = new Set(['some', 'every', 'none'])
export const TO_ONE_RELATION_OPS = new Set(['is', 'isNot'])
export const ALL_RELATION_OPS = new Set([...TO_MANY_RELATION_OPS, ...TO_ONE_RELATION_OPS])

export function toDelegateKey(modelName: string): string {
  return modelName[0].toLowerCase() + modelName.slice(1)
}