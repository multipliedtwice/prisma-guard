import { z } from 'zod'
import type {
  TypeMap, EnumMap, QueryMethod,
  ShapeConfig, ShapeOrFn, NestedIncludeArgs, NestedSelectArgs,
  QuerySchema,
} from '../shared/types.js'
import { ShapeError, CallerError } from '../shared/errors.js'
import { requireContext } from './policy.js'
import { createOperatorSchema, createBaseType } from './zod-type-map.js'

const METHOD_ALLOWED_ARGS: Record<QueryMethod, Set<string>> = {
  findMany: new Set(['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct']),
  findFirst: new Set(['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct']),
  findFirstOrThrow: new Set(['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct']),
  findUnique: new Set(['where', 'include', 'select']),
  findUniqueOrThrow: new Set(['where', 'include', 'select']),
  count: new Set(['where']),
  aggregate: new Set(['where', '_count', '_avg', '_sum', '_min', '_max']),
  groupBy: new Set(['where', 'by', '_count', '_avg', '_sum', '_min', '_max', 'orderBy', 'take', 'skip']),
}

const SHAPE_CONFIG_KEYS = new Set([
  'where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip',
  'distinct',
  '_count', '_avg', '_sum', '_min', '_max', 'by',
])
const STRING_MODE_OPS = new Set(['contains', 'startsWith', 'endsWith', 'equals'])
const RESERVED_CALLER_KEYS = SHAPE_CONFIG_KEYS

interface ForcedTree {
  where?: Record<string, unknown>
  include?: Record<string, ForcedTree>
  select?: Record<string, ForcedTree>
}

interface BuiltShape {
  zodSchema: z.ZodObject<any>
  forcedWhere: Record<string, unknown>
  forcedIncludeTree: Record<string, ForcedTree>
  forcedSelectTree: Record<string, ForcedTree>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function createQueryBuilder(typeMap: TypeMap, enumMap: EnumMap) {
  function isShapeConfig(obj: unknown): obj is ShapeConfig {
    if (!isPlainObject(obj)) return false
    const keys = Object.keys(obj)
    return keys.length === 0 || keys.every(k => SHAPE_CONFIG_KEYS.has(k))
  }

  function buildWhereSchema(
    model: string,
    whereConfig: Record<string, Record<string, true | unknown>>,
  ): { schema: z.ZodTypeAny | null; forced: Record<string, unknown> } {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    const forced: Record<string, Record<string, unknown>> = {}

    for (const [fieldName, operators] of Object.entries(whereConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in where`)
      if (fieldMeta.type === 'Json') throw new ShapeError(`Json field "${fieldName}" cannot be used in where`)

      const opSchemas: Record<string, z.ZodTypeAny> = {}
      const fieldForced: Record<string, unknown> = {}
      let hasClientOps = false
      let hasStringModeOp = false

      for (const [op, value] of Object.entries(operators)) {
        if (value === true) {
          opSchemas[op] = createOperatorSchema(fieldMeta, op, enumMap).optional()
          hasClientOps = true
          if (fieldMeta.type === 'String' && STRING_MODE_OPS.has(op)) {
            hasStringModeOp = true
          }
        } else {
          fieldForced[op] = value
        }
      }

      if (hasStringModeOp) {
        opSchemas['mode'] = z.enum(['default', 'insensitive']).optional()
      }

      if (hasClientOps) {
        fieldSchemas[fieldName] = z.object(opSchemas).strict().optional()
      }

      if (Object.keys(fieldForced).length > 0) {
        forced[fieldName] = fieldForced
      }
    }

    const schema = Object.keys(fieldSchemas).length > 0
      ? z.object(fieldSchemas).strict().optional()
      : null

    return { schema, forced }
  }

  function buildCountFieldSchema(
    model: string,
    config: true | Record<string, true>,
    context: string,
  ): z.ZodTypeAny {
    if (config === true) {
      return z.literal(true).optional()
    }

    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    for (const fieldName of Object.keys(config)) {
      if (fieldName !== '_all') {
        const fieldMeta = modelFields[fieldName]
        if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in ${context}`)
      }
      fieldSchemas[fieldName] = z.literal(true).optional()
    }
    return z.object(fieldSchemas).strict().optional()
  }

  function buildIncludeCountSchema(
    model: string,
    config: true | Record<string, unknown>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    if (config === true) {
      return z.literal(true).optional()
    }

    if (!isPlainObject(config) || !('select' in config)) {
      throw new ShapeError(`Invalid _count config on model "${model}". Expected true or { select: { ... } }`)
    }

    const selectObj = config.select as Record<string, true>
    const countSelectFields: Record<string, z.ZodTypeAny> = {}

    for (const fieldName of Object.keys(selectObj)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in _count.select`)
      if (!fieldMeta.isRelation) throw new ShapeError(`Field "${fieldName}" is not a relation on model "${model}" in _count.select`)
      countSelectFields[fieldName] = z.literal(true).optional()
    }

    const selectSchema = z.object(countSelectFields).strict()
    return z.object({ select: selectSchema }).strict().optional()
  }

  function buildAggregateFieldSchema(
    model: string,
    opName: string,
    fieldConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    for (const fieldName of Object.keys(fieldConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in ${opName}`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in ${opName}`)
      fieldSchemas[fieldName] = z.literal(true).optional()
    }
    return z.object(fieldSchemas).strict().optional()
  }

  function buildBySchema(
    model: string,
    byConfig: string[],
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    for (const fieldName of byConfig) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in by`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in by`)
    }
    return z.array(z.enum(byConfig as [string, ...string[]])).min(1)
  }

  function buildCursorSchema(
    model: string,
    cursorConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    for (const fieldName of Object.keys(cursorConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in cursor`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in cursor`)
      fieldSchemas[fieldName] = createBaseType(fieldMeta, enumMap)
    }
    return z.object(fieldSchemas).strict().optional()
  }

  function buildDistinctSchema(
    model: string,
    distinctConfig: string[],
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    for (const fieldName of distinctConfig) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in distinct`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in distinct`)
    }

    const enumSchema = z.enum(distinctConfig as [string, ...string[]])
    return z.union([enumSchema, z.array(enumSchema).min(1)]).optional()
  }

  function buildIncludeSchema(
    model: string,
    includeConfig: Record<string, true | NestedIncludeArgs>,
  ): { schema: z.ZodTypeAny; forcedTree: Record<string, ForcedTree> } {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    const forcedTree: Record<string, ForcedTree> = {}

    for (const [relName, config] of Object.entries(includeConfig)) {
      if (relName === '_count') {
        fieldSchemas['_count'] = buildIncludeCountSchema(model, config as true | Record<string, unknown>)
        continue
      }

      const fieldMeta = modelFields[relName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${relName}" on model "${model}"`)
      if (!fieldMeta.isRelation) throw new ShapeError(`Field "${relName}" is not a relation on model "${model}"`)

      if (config === true) {
        fieldSchemas[relName] = z.literal(true).optional()
      } else {
        if (config.select && config.include) {
          throw new ShapeError(
            `Nested include for "${relName}" cannot define both "select" and "include".`,
          )
        }

        const nestedSchemas: Record<string, z.ZodTypeAny> = {}
        const relForced: ForcedTree = {}

        if (config.where) {
          const { schema: whereSchema, forced } = buildWhereSchema(fieldMeta.type, config.where)
          if (whereSchema) nestedSchemas['where'] = whereSchema
          if (Object.keys(forced).length > 0) relForced.where = forced
        }
        if (config.include) {
          const nested = buildIncludeSchema(fieldMeta.type, config.include)
          nestedSchemas['include'] = nested.schema
          if (Object.keys(nested.forcedTree).length > 0) relForced.include = nested.forcedTree
        }
        if (config.select) {
          const nested = buildSelectSchema(fieldMeta.type, config.select)
          nestedSchemas['select'] = nested.schema
          if (Object.keys(nested.forcedTree).length > 0) relForced.select = nested.forcedTree
        }
        if (config.orderBy) {
          nestedSchemas['orderBy'] = buildOrderBySchema(fieldMeta.type, config.orderBy)
        }
        if (config.cursor) {
          nestedSchemas['cursor'] = buildCursorSchema(fieldMeta.type, config.cursor)
        }
        if (config.take) {
          nestedSchemas['take'] = buildTakeSchema(config.take)
        }
        if (config.skip) {
          nestedSchemas['skip'] = z.number().int().min(0).optional()
        }

        const nestedObj = z.object(nestedSchemas).strict()
        fieldSchemas[relName] = z.union([z.literal(true), nestedObj]).optional()

        if (Object.keys(relForced).length > 0) forcedTree[relName] = relForced
      }
    }

    return {
      schema: z.object(fieldSchemas).strict().optional(),
      forcedTree,
    }
  }

  function buildSelectSchema(
    model: string,
    selectConfig: Record<string, true | NestedSelectArgs>,
  ): { schema: z.ZodTypeAny; forcedTree: Record<string, ForcedTree> } {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    const forcedTree: Record<string, ForcedTree> = {}

    for (const [fieldName, config] of Object.entries(selectConfig)) {
      if (fieldName === '_count') {
        fieldSchemas['_count'] = buildIncludeCountSchema(model, config as true | Record<string, unknown>)
        continue
      }

      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)

      if (config === true) {
        fieldSchemas[fieldName] = z.literal(true).optional()
      } else {
        if (!fieldMeta.isRelation) {
          throw new ShapeError(`Nested select args only valid for relations, not scalar "${fieldName}"`)
        }
        const nestedSchemas: Record<string, z.ZodTypeAny> = {}
        const relForced: ForcedTree = {}

        if (config.select) {
          const nested = buildSelectSchema(fieldMeta.type, config.select)
          nestedSchemas['select'] = nested.schema
          if (Object.keys(nested.forcedTree).length > 0) relForced.select = nested.forcedTree
        }
        if (config.where) {
          const { schema: whereSchema, forced } = buildWhereSchema(fieldMeta.type, config.where)
          if (whereSchema) nestedSchemas['where'] = whereSchema
          if (Object.keys(forced).length > 0) relForced.where = forced
        }
        if (config.orderBy) {
          nestedSchemas['orderBy'] = buildOrderBySchema(fieldMeta.type, config.orderBy)
        }
        if (config.cursor) {
          nestedSchemas['cursor'] = buildCursorSchema(fieldMeta.type, config.cursor)
        }
        if (config.take) {
          nestedSchemas['take'] = buildTakeSchema(config.take)
        }
        if (config.skip) {
          nestedSchemas['skip'] = z.number().int().min(0).optional()
        }

        const nestedObj = z.object(nestedSchemas).strict()
        fieldSchemas[fieldName] = z.union([z.literal(true), nestedObj]).optional()

        if (Object.keys(relForced).length > 0) forcedTree[fieldName] = relForced
      }
    }

    return {
      schema: z.object(fieldSchemas).strict().optional(),
      forcedTree,
    }
  }

  function buildOrderBySchema(
    model: string,
    orderByConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}

    for (const fieldName of Object.keys(orderByConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in orderBy`)
      if (fieldMeta.type === 'Json') throw new ShapeError(`Json field "${fieldName}" cannot be used in orderBy`)

      fieldSchemas[fieldName] = z.enum(['asc', 'desc']).optional()
    }

    const singleSchema = z.object(fieldSchemas).strict()
    return z.union([singleSchema, z.array(singleSchema)]).optional()
  }

  function buildTakeSchema(config: { max: number; default: number }): z.ZodTypeAny {
    if (config.default > config.max) {
      throw new ShapeError('take default cannot exceed max')
    }
    return z.number().int().min(1).max(config.max).default(config.default)
  }

  function validateShapeArgs(method: QueryMethod, shape: ShapeConfig): void {
    const allowed = METHOD_ALLOWED_ARGS[method]
    for (const key of Object.keys(shape)) {
      if (SHAPE_CONFIG_KEYS.has(key) && !allowed.has(key)) {
        throw new ShapeError(`Arg "${key}" not allowed for method "${method}"`)
      }
    }
    if (shape.include && shape.select) {
      throw new ShapeError('Shape config cannot define both "include" and "select".')
    }
    if (method === 'groupBy' && !shape.by) {
      throw new ShapeError('groupBy shape must define "by"')
    }
    if (method === 'groupBy' && (shape.include || shape.select)) {
      throw new ShapeError('groupBy does not support "include" or "select"')
    }
    if (method === 'aggregate' && (shape.include || shape.select)) {
      throw new ShapeError('aggregate does not support "include" or "select"')
    }
  }

  function buildShapeZodSchema(
    model: string,
    method: QueryMethod,
    shape: ShapeConfig,
  ): BuiltShape {
    validateShapeArgs(method, shape)

    const schemaFields: Record<string, z.ZodTypeAny> = {}
    let forcedWhere: Record<string, unknown> = {}
    let forcedIncludeTree: Record<string, ForcedTree> = {}
    let forcedSelectTree: Record<string, ForcedTree> = {}

    if (shape.where) {
      const { schema, forced } = buildWhereSchema(model, shape.where)
      if (schema) schemaFields['where'] = schema
      forcedWhere = forced
    }

    if (shape.include) {
      const { schema, forcedTree } = buildIncludeSchema(model, shape.include)
      schemaFields['include'] = schema
      forcedIncludeTree = forcedTree
    }

    if (shape.select) {
      const { schema, forcedTree } = buildSelectSchema(model, shape.select)
      schemaFields['select'] = schema
      forcedSelectTree = forcedTree
    }

    if (shape.orderBy) {
      schemaFields['orderBy'] = buildOrderBySchema(model, shape.orderBy)
    }

    if (shape.cursor) {
      schemaFields['cursor'] = buildCursorSchema(model, shape.cursor)
    }

    if (shape.take) {
      schemaFields['take'] = buildTakeSchema(shape.take)
    }

    if (shape.skip) {
      schemaFields['skip'] = z.number().int().min(0).optional()
    }

    if (shape.distinct) {
      schemaFields['distinct'] = buildDistinctSchema(model, shape.distinct)
    }

    if (shape._count) {
      schemaFields['_count'] = buildCountFieldSchema(model, shape._count, '_count')
    }

    if (shape._avg) {
      schemaFields['_avg'] = buildAggregateFieldSchema(model, '_avg', shape._avg)
    }

    if (shape._sum) {
      schemaFields['_sum'] = buildAggregateFieldSchema(model, '_sum', shape._sum)
    }

    if (shape._min) {
      schemaFields['_min'] = buildAggregateFieldSchema(model, '_min', shape._min)
    }

    if (shape._max) {
      schemaFields['_max'] = buildAggregateFieldSchema(model, '_max', shape._max)
    }

    if (shape.by) {
      schemaFields['by'] = buildBySchema(model, shape.by)
    }

    return {
      zodSchema: z.object(schemaFields).strict(),
      forcedWhere,
      forcedIncludeTree,
      forcedSelectTree,
    }
  }

  function mergeForced(
    where: Record<string, unknown> | undefined,
    forced: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!where) return forced
    return { AND: [where, forced] }
  }

  function applyForcedTree(
    validated: Record<string, unknown>,
    key: 'include' | 'select',
    tree: Record<string, ForcedTree>,
  ): void {
    const container = validated[key] as Record<string, unknown> | undefined
    if (!container) return

    for (const [relName, forced] of Object.entries(tree)) {
      const relVal = container[relName]
      if (relVal === undefined) continue

      if (relVal === true) {
        const expanded: Record<string, unknown> = {}
        if (forced.where) expanded.where = forced.where
        if (forced.include) {
          expanded.include = buildForcedOnlyContainer(forced.include)
          applyForcedTree(expanded, 'include', forced.include)
        }
        if (forced.select) {
          expanded.select = buildForcedOnlyContainer(forced.select)
          applyForcedTree(expanded, 'select', forced.select)
        }
        if (expanded.include && expanded.select) {
          throw new ShapeError(
            `Forced tree for relation "${relName}" produces both "include" and "select". Prisma does not allow both at the same level.`,
          )
        }
        container[relName] = Object.keys(expanded).length > 0 ? expanded : true
        continue
      }

      if (isPlainObject(relVal)) {
        const relObj = relVal as Record<string, unknown>
        if (forced.where) {
          relObj.where = mergeForced(
            relObj.where as Record<string, unknown> | undefined,
            forced.where,
          )
        }
        if (forced.include) {
          if (!relObj.include) relObj.include = buildForcedOnlyContainer(forced.include)
          applyForcedTree(relObj, 'include', forced.include)
        }
        if (forced.select) {
          if (!relObj.select) relObj.select = buildForcedOnlyContainer(forced.select)
          applyForcedTree(relObj, 'select', forced.select)
        }
        if (relObj.include && relObj.select) {
          throw new ShapeError(
            `Relation "${relName}" has both "include" and "select" after forced tree merge. Prisma does not allow both at the same level.`,
          )
        }
      }
    }
  }

  function buildForcedOnlyContainer(
    tree: Record<string, ForcedTree>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [relName, forced] of Object.entries(tree)) {
      const nested: Record<string, unknown> = {}
      if (forced.where) nested.where = forced.where
      if (forced.include) nested.include = buildForcedOnlyContainer(forced.include)
      if (forced.select) nested.select = buildForcedOnlyContainer(forced.select)
      result[relName] = Object.keys(nested).length > 0 ? nested : true
    }
    return result
  }

  function matchCaller<TCtx>(
    shapes: Record<string, ShapeOrFn<TCtx>>,
    caller: string,
  ): { key: string; shape: ShapeOrFn<TCtx> } | null {
    if (Object.hasOwn(shapes, caller)) {
      return { key: caller, shape: shapes[caller] }
    }

    const matches: { key: string; shape: ShapeOrFn<TCtx> }[] = []

    for (const [pattern, shape] of Object.entries(shapes)) {
      if (!pattern.includes(':')) continue
      const patternParts = pattern.split('/')
      const callerParts = caller.split('/')
      if (patternParts.length !== callerParts.length) continue

      let ok = true
      for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i]
        if (p.startsWith(':')) continue
        if (p !== callerParts[i]) {
          ok = false
          break
        }
      }
      if (ok) matches.push({ key: pattern, shape })
    }

    if (matches.length === 0) return null
    if (matches.length > 1) {
      throw new ShapeError(
        `Caller "${caller}" matches multiple patterns: ${matches.map(m => `"${m.key}"`).join(', ')}`,
      )
    }
    return matches[0]
  }

  function buildQuerySchema<TCtx>(
    model: string,
    method: QueryMethod,
    config: ShapeOrFn<TCtx> | Record<string, ShapeOrFn<TCtx>>,
  ): QuerySchema<TCtx> {
    const isSingleShape = typeof config === 'function' || isShapeConfig(config)
    const builtCache = new Map<string, BuiltShape>()

    if (isSingleShape && typeof config !== 'function') {
      const built = buildShapeZodSchema(model, method, config as ShapeConfig)
      builtCache.set('_default', built)
    }

    if (!isSingleShape) {
      for (const key of Object.keys(config as Record<string, unknown>)) {
        if (RESERVED_CALLER_KEYS.has(key)) {
          throw new ShapeError(
            `Caller key "${key}" collides with reserved shape config key. Rename the caller path.`,
          )
        }
      }

      for (const [key, shapeOrFn] of Object.entries(config as Record<string, ShapeOrFn<TCtx>>)) {
        if (typeof shapeOrFn !== 'function') {
          const built = buildShapeZodSchema(model, method, shapeOrFn as ShapeConfig)
          builtCache.set(key, built)
        }
      }
    }

    return {
      schemas: Object.fromEntries(
        [...builtCache.entries()].map(([k, v]) => [k, v.zodSchema]),
      ),
      parse(body: unknown, opts?: { ctx?: TCtx }): Record<string, unknown> {
        let built: BuiltShape

        if (isSingleShape) {
          if (typeof config === 'function') {
            requireContext(opts?.ctx, 'shape function')
            const resolvedShape = config(opts!.ctx!)
            built = buildShapeZodSchema(model, method, resolvedShape)
          } else {
            built = builtCache.get('_default')!
          }
        } else {
          if (!isPlainObject(body)) {
            throw new ShapeError('Request body must be an object')
          }
          const caller = body.caller
          if (typeof caller !== 'string') {
            throw new ShapeError('Missing "caller" field in request body')
          }

          const matched = matchCaller(config as Record<string, ShapeOrFn<TCtx>>, caller)
          if (!matched) {
            const allowed = Object.keys(config as Record<string, ShapeOrFn<TCtx>>)
            throw new CallerError(`${caller}. Allowed callers: ${allowed.map(k => `"${k}"`).join(', ')}`)
          }

          const shapeKey = matched.key
          const shapeOrFn = matched.shape

          if (typeof shapeOrFn === 'function') {
            requireContext(opts?.ctx, 'shape function')
            const resolvedShape = shapeOrFn(opts!.ctx!)
            built = buildShapeZodSchema(model, method, resolvedShape)
          } else {
            built = builtCache.get(shapeKey)!
          }

          const { caller: _, ...rest } = body
          body = rest
        }

        const validated = built.zodSchema.parse(body) as Record<string, unknown>

        if (Object.keys(built.forcedWhere).length > 0) {
          validated.where = mergeForced(
            validated.where as Record<string, unknown> | undefined,
            built.forcedWhere,
          )
        }

        if (Object.keys(built.forcedIncludeTree).length > 0) {
          applyForcedTree(validated, 'include', built.forcedIncludeTree)
        }

        if (Object.keys(built.forcedSelectTree).length > 0) {
          applyForcedTree(validated, 'select', built.forcedSelectTree)
        }

        return validated
      },
    }
  }

  return { buildQuerySchema }
}