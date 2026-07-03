export const OPERATION_SHAPE_KEYS = {
  findMany: ['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct'],
  findManyPaginated: ['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct'],
  findFirst: ['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct'],
  findFirstOrThrow: ['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct'],
  findUnique: ['where', 'include', 'select'],
  findUniqueOrThrow: ['where', 'include', 'select'],
  count: ['where', 'select', 'cursor', 'orderBy', 'skip', 'take'],
  aggregate: ['where', 'orderBy', 'cursor', 'take', 'skip', '_count', '_avg', '_sum', '_min', '_max'],
  groupBy: ['where', 'orderBy', 'by', 'having', 'take', 'skip', '_count', '_avg', '_sum', '_min', '_max'],
  create: ['data', 'include', 'select'],
  createMany: ['data', 'skipDuplicates'],
  createManyAndReturn: ['data', 'select', 'skipDuplicates'],
  update: ['where', 'data', 'include', 'select'],
  updateMany: ['where', 'data'],
  updateManyAndReturn: ['where', 'data', 'select'],
  upsert: ['where', 'create', 'update', 'include', 'select'],
  delete: ['where', 'include', 'select'],
  deleteMany: ['where'],
} as const

export type OperationName = keyof typeof OPERATION_SHAPE_KEYS

export type OperationShapeKey<O extends OperationName> =
  (typeof OPERATION_SHAPE_KEYS)[O][number]

export const READ_METHOD_ALLOWED_ARGS: Record<string, Set<string>> = {
  findMany: new Set(OPERATION_SHAPE_KEYS.findMany),
  findFirst: new Set(OPERATION_SHAPE_KEYS.findFirst),
  findFirstOrThrow: new Set(OPERATION_SHAPE_KEYS.findFirstOrThrow),
  findUnique: new Set(OPERATION_SHAPE_KEYS.findUnique),
  findUniqueOrThrow: new Set(OPERATION_SHAPE_KEYS.findUniqueOrThrow),
  count: new Set(OPERATION_SHAPE_KEYS.count),
  aggregate: new Set(OPERATION_SHAPE_KEYS.aggregate),
  groupBy: new Set(OPERATION_SHAPE_KEYS.groupBy),
}

export const MUTATION_SHAPE_KEYS = {
  create: new Set(OPERATION_SHAPE_KEYS.create),
  createMany: new Set(OPERATION_SHAPE_KEYS.createMany),
  createManyAndReturn: new Set(OPERATION_SHAPE_KEYS.createManyAndReturn),
  update: new Set(OPERATION_SHAPE_KEYS.update),
  updateMany: new Set(OPERATION_SHAPE_KEYS.updateMany),
  updateManyAndReturn: new Set(OPERATION_SHAPE_KEYS.updateManyAndReturn),
  upsert: new Set(OPERATION_SHAPE_KEYS.upsert),
  delete: new Set(OPERATION_SHAPE_KEYS.delete),
  deleteMany: new Set(OPERATION_SHAPE_KEYS.deleteMany),
}

export interface MutationOperationSpec {
  bodyKeysBase: readonly string[]
  bodyKeysProjection: readonly string[]
  shapeKeysBase: readonly string[]
  shapeKeysProjection: readonly string[]
  supportsProjection: boolean
}

export const MUTATION_OPERATION_SPECS: Record<string, MutationOperationSpec> = {
  create: {
    bodyKeysBase: ['data'],
    bodyKeysProjection: ['data', 'select', 'include'],
    shapeKeysBase: ['data'],
    shapeKeysProjection: ['data', 'select', 'include'],
    supportsProjection: true,
  },
  createMany: {
    bodyKeysBase: ['data', 'skipDuplicates'],
    bodyKeysProjection: ['data', 'select', 'include', 'skipDuplicates'],
    shapeKeysBase: ['data'],
    shapeKeysProjection: ['data'],
    supportsProjection: false,
  },
  createManyAndReturn: {
    bodyKeysBase: ['data', 'skipDuplicates'],
    bodyKeysProjection: ['data', 'select', 'include', 'skipDuplicates'],
    shapeKeysBase: ['data'],
    shapeKeysProjection: ['data', 'select', 'include'],
    supportsProjection: true,
  },
  update: {
    bodyKeysBase: ['data', 'where'],
    bodyKeysProjection: ['data', 'where', 'select', 'include'],
    shapeKeysBase: ['data', 'where'],
    shapeKeysProjection: ['data', 'where', 'select', 'include'],
    supportsProjection: true,
  },
  updateMany: {
    bodyKeysBase: ['data', 'where'],
    bodyKeysProjection: ['data', 'where'],
    shapeKeysBase: ['data', 'where'],
    shapeKeysProjection: ['data', 'where'],
    supportsProjection: false,
  },
  updateManyAndReturn: {
    bodyKeysBase: ['data', 'where'],
    bodyKeysProjection: ['data', 'where', 'select', 'include'],
    shapeKeysBase: ['data', 'where'],
    shapeKeysProjection: ['data', 'where', 'select', 'include'],
    supportsProjection: true,
  },
  upsert: {
    bodyKeysBase: ['where', 'create', 'update', 'select', 'include'],
    bodyKeysProjection: ['where', 'create', 'update', 'select', 'include'],
    shapeKeysBase: ['where', 'create', 'update', 'select', 'include'],
    shapeKeysProjection: ['where', 'create', 'update', 'select', 'include'],
    supportsProjection: true,
  },
  delete: {
    bodyKeysBase: ['where'],
    bodyKeysProjection: ['where', 'select', 'include'],
    shapeKeysBase: ['where'],
    shapeKeysProjection: ['where', 'select', 'include'],
    supportsProjection: true,
  },
  deleteMany: {
    bodyKeysBase: ['where'],
    bodyKeysProjection: ['where'],
    shapeKeysBase: ['where'],
    shapeKeysProjection: ['where'],
    supportsProjection: false,
  },
}

const bodyKeyCache = new Map<string, Set<string>>()
const shapeKeyCache = new Map<string, Set<string>>()

export function getAllowedBodyKeys(method: string, withProjection: boolean): Set<string> {
  const cacheKey = `${method}\0${withProjection ? 'p' : 'b'}`
  const cached = bodyKeyCache.get(cacheKey)
  if (cached) return cached

  const spec = MUTATION_OPERATION_SPECS[method]
  if (!spec) throw new Error(`Unknown mutation method "${method}"`)

  const keys = withProjection && spec.supportsProjection
    ? spec.bodyKeysProjection
    : spec.bodyKeysBase

  const set = new Set(keys)
  bodyKeyCache.set(cacheKey, set)
  return set
}

export function getAllowedShapeKeys(method: string, withProjection: boolean): Set<string> {
  const cacheKey = `${method}\0${withProjection ? 'p' : 'b'}`
  const cached = shapeKeyCache.get(cacheKey)
  if (cached) return cached

  const spec = MUTATION_OPERATION_SPECS[method]
  if (!spec) throw new Error(`Unknown mutation method "${method}"`)

  const keys = withProjection && spec.supportsProjection
    ? spec.shapeKeysProjection
    : spec.shapeKeysBase

  const set = new Set(keys)
  shapeKeyCache.set(cacheKey, set)
  return set
}

export function methodSupportsProjection(method: string): boolean {
  const spec = MUTATION_OPERATION_SPECS[method]
  return spec ? spec.supportsProjection : false
}