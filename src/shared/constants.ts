export const SHAPE_CONFIG_KEYS = new Set([
  'where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip',
  'distinct', 'having', '_count', '_avg', '_sum', '_min', '_max', 'by',
])

export const GUARD_SHAPE_KEYS = new Set([
  'data', ...SHAPE_CONFIG_KEYS,
])