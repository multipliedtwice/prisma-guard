import { z } from 'zod'
import type {
  TypeMap, EnumMap, UniqueMap, QueryMethod,
  ShapeConfig, ShapeOrFn, QuerySchema, NestedSelectArgs,
} from '../shared/types.js'
import { ShapeError, CallerError } from '../shared/errors.js'
import { SHAPE_CONFIG_KEYS, GUARD_SHAPE_KEYS } from '../shared/constants.js'
import { matchCallerPattern } from '../shared/match-caller.js'
import { isPlainObject } from '../shared/utils.js'
import { requireContext } from './policy.js'
import { createWhereBuilder } from './query-builder-where.js'
import { createArgsBuilder } from './query-builder-args.js'
import { createProjectionBuilder } from './query-builder-projection.js'
import {
  applyBuiltShape, EMPTY_WHERE_FORCED, hasWhereForced,
  validateUniqueEquality,
} from './query-builder-forced.js'
import type { BuiltShape, WhereForced } from './query-builder-forced.js'
import type { WhereBuiltResult } from './query-builder-where.js'
import type { BuiltIncludeResult, BuiltSelectResult } from './query-builder-projection.js'
import type { ScalarBaseMap } from '../shared/scalar-base.js'

const METHOD_ALLOWED_ARGS: Record<QueryMethod, Set<string>> = {
  findMany: new Set(['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct']),
  findFirst: new Set(['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct']),
  findFirstOrThrow: new Set(['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip', 'distinct']),
  findUnique: new Set(['where', 'include', 'select']),
  findUniqueOrThrow: new Set(['where', 'include', 'select']),
  count: new Set(['where', 'select', 'cursor', 'orderBy', 'skip', 'take']),
  aggregate: new Set(['where', 'orderBy', 'cursor', 'take', 'skip', '_count', '_avg', '_sum', '_min', '_max']),
  groupBy: new Set(['where', 'by', 'having', '_count', '_avg', '_sum', '_min', '_max', 'orderBy', 'take', 'skip']),
}

const UNIQUE_WHERE_METHODS: Set<QueryMethod> = new Set(['findUnique', 'findUniqueOrThrow'])

export function createQueryBuilder(
  typeMap: TypeMap,
  enumMap: EnumMap,
  uniqueMap: UniqueMap,
  scalarBase: ScalarBaseMap,
) {
  const whereBuilder = createWhereBuilder(typeMap, enumMap, scalarBase)
  const argsBuilder = createArgsBuilder(typeMap, enumMap, uniqueMap, scalarBase)
  const projectionBuilder = createProjectionBuilder(typeMap, enumMap, {
    buildWhereSchema: whereBuilder.buildWhereSchema,
    buildOrderBySchema: argsBuilder.buildOrderBySchema,
    buildCursorSchema: argsBuilder.buildCursorSchema,
    buildTakeSchema: argsBuilder.buildTakeSchema,
  })

  function isShapeConfig(obj: unknown): obj is ShapeConfig {
    if (!isPlainObject(obj)) return false
    const keys = Object.keys(obj)
    return keys.length === 0 || keys.every(k => SHAPE_CONFIG_KEYS.has(k))
  }

  function validateShapeArgs(method: QueryMethod, shape: ShapeConfig): void {
    const allowed = METHOD_ALLOWED_ARGS[method]
    for (const key of Object.keys(shape)) {
      if (!SHAPE_CONFIG_KEYS.has(key)) throw new ShapeError(`Unknown shape config key "${key}"`)
      if (!allowed.has(key)) throw new ShapeError(`Arg "${key}" not allowed for method "${method}"`)
    }
    if (UNIQUE_WHERE_METHODS.has(method) && !shape.where) {
      throw new ShapeError(`${method} shape must define "where"`)
    }
    if (shape.include && shape.select) {
      throw new ShapeError('Shape config cannot define both "include" and "select".')
    }
    if (method === 'groupBy' && !shape.by) throw new ShapeError('groupBy shape must define "by"')
    if (method === 'groupBy' && (shape.include || shape.select)) {
      throw new ShapeError('groupBy does not support "include" or "select"')
    }
    if (method === 'aggregate' && (shape.include || shape.select)) {
      throw new ShapeError('aggregate does not support "include" or "select"')
    }
    if (method === 'count' && shape.include) throw new ShapeError('count does not support "include"')
    if (method === 'groupBy' && shape.orderBy) {
      const bySet = new Set(shape.by)
      for (const fieldName of Object.keys(shape.orderBy)) {
        if (!bySet.has(fieldName)) {
          throw new ShapeError(`orderBy field "${fieldName}" must be included in "by" for groupBy`)
        }
      }
    }
    if (method === 'groupBy' && shape.having) {
      const bySet = new Set(shape.by)
      for (const fieldName of Object.keys(shape.having)) {
        if (!bySet.has(fieldName)) {
          throw new ShapeError(`having field "${fieldName}" must be included in "by" for groupBy`)
        }
      }
    }
  }

  function validateUniqueWhere(
    model: string,
    method: QueryMethod,
    shape: ShapeConfig,
  ): void {
    if (!UNIQUE_WHERE_METHODS.has(method)) return
    if (!shape.where) return
    validateUniqueEquality(model, shape.where, method, uniqueMap, typeMap)
  }

  function resolveAndValidateShape(shapeOrFn: ShapeOrFn<any>, ctx?: any): ShapeConfig {
    if (typeof shapeOrFn === 'function') {
      requireContext(ctx, 'shape function')
      const result = shapeOrFn(ctx)
      if (!isPlainObject(result)) {
        throw new ShapeError('Dynamic shape function must return a plain object')
      }
      return result as ShapeConfig
    }
    return shapeOrFn as ShapeConfig
  }

  function buildShapeZodSchema(
    model: string,
    method: QueryMethod,
    shape: ShapeConfig,
  ): BuiltShape {
    validateShapeArgs(method, shape)
    validateUniqueWhere(model, method, shape)

    const schemaFields: Record<string, z.ZodTypeAny> = {}
    let forcedWhere: WhereForced = EMPTY_WHERE_FORCED
    let forcedIncludeTree: Record<string, import('./query-builder-forced.js').ForcedTree> = {}
    let forcedSelectTree: Record<string, import('./query-builder-forced.js').ForcedTree> = {}
    let forcedIncludeCountWhere: Record<string, WhereForced> = {}
    let forcedSelectCountWhere: Record<string, WhereForced> = {}

    if (shape.where) {
      const { schema, forced } = whereBuilder.buildWhereSchema(model, shape.where)
      if (schema) schemaFields['where'] = schema
      forcedWhere = forced
    }

    if (shape.include) {
      const result = projectionBuilder.buildIncludeSchema(model, shape.include)
      schemaFields['include'] = result.schema
      forcedIncludeTree = result.forcedTree
      forcedIncludeCountWhere = result.forcedCountWhere
    }

    if (shape.select) {
      if (method === 'count') {
        schemaFields['select'] = argsBuilder.buildCountSelectSchema(model, shape.select as Record<string, true>)
      } else {
        const result = projectionBuilder.buildSelectSchema(model, shape.select)
        schemaFields['select'] = result.schema
        forcedSelectTree = result.forcedTree
        forcedSelectCountWhere = result.forcedCountWhere
      }
    }

    if (shape.orderBy) schemaFields['orderBy'] = argsBuilder.buildOrderBySchema(model, shape.orderBy)
    if (shape.cursor) schemaFields['cursor'] = argsBuilder.buildCursorSchema(model, shape.cursor)
    if (shape.take) schemaFields['take'] = argsBuilder.buildTakeSchema(shape.take)
    if (shape.skip !== undefined) {
      if (shape.skip !== true) {
        throw new ShapeError('Shape config "skip" must be true')
      }
      schemaFields['skip'] = z.number().int().min(0).optional()
    }
    if (shape.distinct) schemaFields['distinct'] = argsBuilder.buildDistinctSchema(model, shape.distinct)
    if (shape._count) schemaFields['_count'] = argsBuilder.buildCountFieldSchema(model, shape._count, '_count')
    if (shape._avg) schemaFields['_avg'] = argsBuilder.buildAggregateFieldSchema(model, '_avg', shape._avg)
    if (shape._sum) schemaFields['_sum'] = argsBuilder.buildAggregateFieldSchema(model, '_sum', shape._sum)
    if (shape._min) schemaFields['_min'] = argsBuilder.buildAggregateFieldSchema(model, '_min', shape._min)
    if (shape._max) schemaFields['_max'] = argsBuilder.buildAggregateFieldSchema(model, '_max', shape._max)
    if (shape.by) schemaFields['by'] = argsBuilder.buildBySchema(model, shape.by)
    if (shape.having) schemaFields['having'] = argsBuilder.buildHavingSchema(model, shape.having)

    return {
      zodSchema: z.object(schemaFields).strict(),
      forcedWhere,
      forcedIncludeTree,
      forcedSelectTree,
      forcedIncludeCountWhere,
      forcedSelectCountWhere,
    }
  }

  function matchCaller<TCtx>(
    shapes: Record<string, ShapeOrFn<TCtx>>,
    caller: string,
  ): { key: string; shape: ShapeOrFn<TCtx> } | null {
    const matched = matchCallerPattern(Object.keys(shapes), caller)
    if (!matched) return null
    return { key: matched, shape: shapes[matched] }
  }

  function buildQuerySchema<TCtx>(
    model: string,
    method: QueryMethod,
    config: ShapeOrFn<TCtx> | Record<string, ShapeOrFn<TCtx>>,
  ): QuerySchema<TCtx> {
    const isSingle = typeof config === 'function' || isShapeConfig(config)
    const builtCache = new Map<string, BuiltShape>()

    if (isSingle && typeof config !== 'function') {
      builtCache.set('_default', buildShapeZodSchema(model, method, config as ShapeConfig))
    }

    if (!isSingle) {
      for (const key of Object.keys(config as Record<string, unknown>)) {
        if (SHAPE_CONFIG_KEYS.has(key)) {
          throw new ShapeError(`Caller key "${key}" collides with reserved shape config key. Rename the caller path.`)
        }
      }
      for (const [key, shapeOrFn] of Object.entries(config as Record<string, ShapeOrFn<TCtx>>)) {
        if (typeof shapeOrFn !== 'function') {
          builtCache.set(key, buildShapeZodSchema(model, method, shapeOrFn as ShapeConfig))
        }
      }
    }

    const isUnique = UNIQUE_WHERE_METHODS.has(method)

    return {
      schemas: Object.fromEntries(
        [...builtCache.entries()].map(([k, v]) => [k, v.zodSchema]),
      ),
      parse(body: unknown, opts?: { ctx?: TCtx; caller?: string }): Record<string, unknown> {
        const normalizedBody = (body === undefined || body === null) ? {} : body
        let built: BuiltShape

        if (isSingle) {
          if (typeof config === 'function') {
            const resolved = resolveAndValidateShape(config, opts?.ctx)
            built = buildShapeZodSchema(model, method, resolved)
          } else {
            built = builtCache.get('_default')!
          }
        } else {
          if (!isPlainObject(normalizedBody)) throw new ShapeError('Request body must be an object')

          if ('caller' in (normalizedBody as Record<string, unknown>)) {
            throw new CallerError(
              'Pass caller via opts.caller, not in the request body.',
            )
          }

          const caller = opts?.caller
          if (typeof caller !== 'string') {
            const allowed = Object.keys(config as Record<string, ShapeOrFn<TCtx>>)
            throw new CallerError(
              `Missing caller. This query uses named shape routing with keys: ${allowed.map(k => `"${k}"`).join(', ')}. ` +
              `Provide caller via opts.caller.`,
            )
          }

          const matched = matchCaller(config as Record<string, ShapeOrFn<TCtx>>, caller)
          if (!matched) {
            const allowed = Object.keys(config as Record<string, ShapeOrFn<TCtx>>)
            throw new CallerError(
              `Unknown caller: "${caller}". Allowed: ${allowed.map(k => `"${k}"`).join(', ')}`,
            )
          }

          if (typeof matched.shape === 'function') {
            const resolved = resolveAndValidateShape(matched.shape, opts?.ctx)
            built = buildShapeZodSchema(model, method, resolved)
          } else {
            built = builtCache.get(matched.key)!
          }
        }

        return applyBuiltShape(built, normalizedBody, isUnique)
      },
    }
  }

  return {
    buildQuerySchema,
    buildShapeZodSchema,
    buildWhereSchema: whereBuilder.buildWhereSchema,
    buildIncludeSchema: projectionBuilder.buildIncludeSchema,
    buildSelectSchema: projectionBuilder.buildSelectSchema,
  }
}