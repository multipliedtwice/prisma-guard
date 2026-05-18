export const OPERATION_SHAPE_KEYS = {
  findMany: ['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct'],
  findFirst: ['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct'],
  findFirstOrThrow: ['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct'],
  findUnique: ['where', 'include', 'select'],
  findUniqueOrThrow: ['where', 'include', 'select'],
  findManyPaginated: ['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct'],
  count: ['where', 'select', 'cursor', 'orderBy', 'skip', 'take'],
  aggregate: ['where', 'orderBy', 'cursor', 'take', 'skip', '_count', '_avg', '_sum', '_min', '_max'],
  groupBy: ['where', 'by', 'having', '_count', '_avg', '_sum', '_min', '_max', 'orderBy', 'take', 'skip'],
  create: ['data', 'select', 'include'],
  createMany: ['data'],
  createManyAndReturn: ['data', 'select', 'include'],
  update: ['data', 'where', 'select', 'include'],
  updateMany: ['data', 'where'],
  updateManyAndReturn: ['data', 'where', 'select', 'include'],
  upsert: ['where', 'create', 'update', 'select', 'include'],
  delete: ['where', 'select', 'include'],
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