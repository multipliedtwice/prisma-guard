import { z } from 'zod'
import type {
  TypeMap, EnumMap, ZodChains, UniqueMap, ScopeMap, GuardShape,
  GuardInput, GuardShapeOrFn, QueryMethod, GuardedModel, DataFieldRefine,
  NestedIncludeArgs, NestedSelectArgs,
} from '../shared/types.js'
import { ShapeError, CallerError, formatZodError } from '../shared/errors.js'
import { GUARD_SHAPE_KEYS, toDelegateKey } from '../shared/constants.js'
import { matchCallerPattern } from '../shared/match-caller.js'
import { createSchemaBuilder } from './schema-builder.js'
import {
  createQueryBuilder, isPlainObject, mergeForced, mergeUniqueForced,
  applyBuiltShape, validateUniqueEquality, validateResolvedUniqueWhere,
  applyForcedTree, applyForcedCountWhere,
} from './query-builder.js'
import type { BuiltShape, ForcedTree, BuiltIncludeResult, BuiltSelectResult } from './query-builder.js'

const ALLOWED_BODY_KEYS_CREATE = new Set(['data'])
const ALLOWED_BODY_KEYS_CREATE_PROJECTION = new Set(['data', 'select', 'include'])
const ALLOWED_BODY_KEYS_UPDATE = new Set(['data', 'where'])
const ALLOWED_BODY_KEYS_UPDATE_PROJECTION = new Set(['data', 'where', 'select', 'include'])
const ALLOWED_BODY_KEYS_DELETE = new Set(['where'])
const ALLOWED_BODY_KEYS_DELETE_PROJECTION = new Set(['where', 'select', 'include'])

const VALID_SHAPE_KEYS_CREATE = new Set(['data'])
const VALID_SHAPE_KEYS_CREATE_PROJECTION = new Set(['data', 'select', 'include'])
const VALID_SHAPE_KEYS_UPDATE = new Set(['data', 'where'])
const VALID_SHAPE_KEYS_UPDATE_PROJECTION = new Set(['data', 'where', 'select', 'include'])
const VALID_SHAPE_KEYS_DELETE = new Set(['where'])
const VALID_SHAPE_KEYS_DELETE_PROJECTION = new Set(['where', 'select', 'include'])

interface BuiltDataSchema {
  schema: z.ZodObject<any>
  forced: Record<string, unknown>
}

interface BuiltProjection {
  zodSchema: z.ZodObject<any>
  forcedIncludeTree: Record<string, ForcedTree>
  forcedSelectTree: Record<string, ForcedTree>
  forcedIncludeCountWhere: Record<string, Record<string, unknown>>
  forcedSelectCountWhere: Record<string, Record<string, unknown>>
}

const UNIQUE_MUTATION_METHODS = new Set(['update', 'delete'])

const UNIQUE_READ_METHODS = new Set<string>(['findUnique', 'findUniqueOrThrow'])

const BULK_MUTATION_METHODS = new Set([
  'updateMany', 'updateManyAndReturn', 'deleteMany',
])

const PROJECTION_MUTATION_METHODS = new Set([
  'create', 'update', 'delete',
  'createManyAndReturn', 'updateManyAndReturn',
])

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.parse === 'function' && typeof v.optional === 'function'
}

function isGuardShape(obj: unknown): obj is GuardShape {
  if (!isPlainObject(obj)) return false
  const keys = Object.keys(obj)
  return keys.length === 0 || keys.every(k => GUARD_SHAPE_KEYS.has(k))
}

function isSingleShape(input: GuardInput): input is GuardShapeOrFn {
  return typeof input === 'function' || isGuardShape(input)
}

function validateMutationBodyKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
  method: string,
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new ShapeError(
        `Unexpected key "${key}" in ${method} body. Allowed keys: ${[...allowed].join(', ')}`,
      )
    }
  }
}

function validateMutationShapeKeys(
  shape: GuardShape,
  allowed: Set<string>,
  method: string,
): void {
  for (const key of Object.keys(shape)) {
    if (!allowed.has(key)) {
      throw new ShapeError(
        `Shape key "${key}" not valid for ${method}. Allowed: ${[...allowed].join(', ')}`,
      )
    }
  }
}

interface ResolvedShape {
  shape: GuardShape
  body: Record<string, unknown>
  matchedKey: string
  wasDynamic: boolean
}

export function createModelGuardExtension(config: {
  typeMap: TypeMap
  enumMap: EnumMap
  zodChains: ZodChains
  uniqueMap: UniqueMap
  scopeMap: ScopeMap
  contextFn: () => Record<string, unknown>
  wrapZodErrors?: boolean
}) {
  const { typeMap, enumMap, zodChains, uniqueMap, scopeMap, contextFn } = config
  const wrapZodErrors = config.wrapZodErrors ?? false
  const schemaBuilder = createSchemaBuilder(typeMap, zodChains, enumMap)
  const queryBuilder = createQueryBuilder(typeMap, enumMap, uniqueMap)

  const modelScopeFks = new Map<string, Set<string>>()
  for (const [model, entries] of Object.entries(scopeMap)) {
    const fks = new Set<string>()
    for (const entry of entries) {
      fks.add(entry.fk)
    }
    modelScopeFks.set(model, fks)
  }

  function validateCreateCompleteness(
    modelName: string,
    dataConfig: Record<string, true | unknown>,
  ): void {
    const modelFields = typeMap[modelName]
    if (!modelFields) return

    const fks = modelScopeFks.get(modelName) ?? new Set<string>()

    for (const [fieldName, meta] of Object.entries(modelFields)) {
      if (meta.isRelation) continue
      if (meta.isUpdatedAt) continue
      if (meta.hasDefault) continue
      if (!meta.isRequired) continue
      if (fieldName in dataConfig) continue
      if (fks.has(fieldName)) continue

      throw new ShapeError(
        `Required field "${fieldName}" on model "${modelName}" is missing from create data shape, has no default, and is not a scope FK`,
      )
    }
  }

  function buildDataSchema(
    model: string,
    dataConfig: Record<string, true | unknown>,
    mode: 'create' | 'update',
  ): BuiltDataSchema {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const schemaMap: Record<string, z.ZodTypeAny> = {}
    const forced: Record<string, unknown> = {}

    for (const [fieldName, value] of Object.entries(dataConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in data shape`)
      if (fieldMeta.isUpdatedAt) throw new ShapeError(`updatedAt field "${fieldName}" cannot be used in data shape`)

      if (typeof value === 'function') {
        let baseSchema: z.ZodTypeAny = schemaBuilder.buildBaseFieldSchema(model, fieldName)
        let refined: unknown
        try {
          refined = (value as DataFieldRefine)(baseSchema)
        } catch (err: any) {
          throw new ShapeError(
            `Invalid inline refine for "${model}.${fieldName}": ${err.message}`,
            { cause: err },
          )
        }

        if (!isZodSchema(refined)) {
          throw new ShapeError(
            `Inline refine for "${model}.${fieldName}" must return a Zod schema`,
          )
        }

        let fieldSchema: z.ZodTypeAny = refined

        if (mode === 'create') {
          if (!fieldMeta.isRequired || fieldMeta.hasDefault) {
            fieldSchema = fieldSchema.optional()
          }
        } else {
          if (!fieldMeta.isRequired) {
            fieldSchema = fieldSchema.nullable().optional()
          } else {
            fieldSchema = fieldSchema.optional()
          }
        }

        schemaMap[fieldName] = fieldSchema
      } else if (value === true) {
        let fieldSchema: z.ZodTypeAny = schemaBuilder.buildFieldSchema(model, fieldName)

        if (mode === 'create') {
          if (!fieldMeta.isRequired || fieldMeta.hasDefault) {
            fieldSchema = fieldSchema.optional()
          }
        } else {
          if (!fieldMeta.isRequired) {
            fieldSchema = fieldSchema.nullable().optional()
          } else {
            fieldSchema = fieldSchema.optional()
          }
        }

        schemaMap[fieldName] = fieldSchema
      } else {
        let fieldSchema: z.ZodTypeAny = schemaBuilder.buildFieldSchema(model, fieldName)
        if (!fieldMeta.isRequired) {
          fieldSchema = fieldSchema.nullable()
        }
        let parsed: unknown
        try {
          parsed = fieldSchema.parse(value)
        } catch (err: any) {
          throw new ShapeError(
            `Invalid forced data value for "${model}.${fieldName}": ${err.message}`,
          )
        }
        forced[fieldName] = parsed
      }
    }

    return {
      schema: z.object(schemaMap).strict(),
      forced,
    }
  }

  function resolveDynamicShape(fn: (ctx: any) => GuardShape): GuardShape {
    let result: unknown
    try {
      result = fn(contextFn())
    } catch (err: any) {
      throw new ShapeError(
        `Dynamic shape function threw: ${err.message}`,
        { cause: err },
      )
    }
    if (!isPlainObject(result)) {
      throw new ShapeError('Dynamic shape function must return a plain object')
    }
    return result as GuardShape
  }

  function resolveShape(
    input: GuardInput,
    body: unknown,
  ): ResolvedShape {
    if (isSingleShape(input)) {
      const wasDynamic = typeof input === 'function'
      const shape = wasDynamic
        ? resolveDynamicShape(input as (ctx: any) => GuardShape)
        : input as GuardShape
      const parsed = body === undefined || body === null
        ? {}
        : requireBody(body)
      if ('caller' in parsed) {
        throw new CallerError(
          'Named shape routing is not configured on this guard. Remove "caller" from the request body or use a named shape map.',
        )
      }
      return { shape, body: parsed, matchedKey: '_default', wasDynamic }
    }

    const namedMap = input as Record<string, GuardShapeOrFn>

    for (const key of Object.keys(namedMap)) {
      if (GUARD_SHAPE_KEYS.has(key)) {
        throw new ShapeError(
          `Caller key "${key}" collides with reserved shape config key. Rename the caller path.`,
        )
      }
      const val = namedMap[key]
      if (typeof val !== 'function' && !isGuardShape(val)) {
        throw new ShapeError(
          `Named shape value for "${key}" must be a guard shape object or function`,
        )
      }
    }

    const parsed = requireBody(body)

    const caller = parsed.caller
    if (typeof caller !== 'string') {
      throw new CallerError('Missing "caller" field in request body')
    }

    const patterns = Object.keys(namedMap)
    const matched = matchCallerPattern(patterns, caller)
    if (!matched) {
      throw new CallerError(
        `Unknown caller: "${caller}". Allowed: ${patterns.map(k => `"${k}"`).join(', ')}`,
      )
    }

    const shapeOrFn = namedMap[matched]
    const wasDynamic = typeof shapeOrFn === 'function'
    const shape = wasDynamic
      ? resolveDynamicShape(shapeOrFn as (ctx: any) => GuardShape)
      : shapeOrFn as GuardShape

    const { caller: _, ...rest } = parsed
    return { shape, body: rest, matchedKey: matched, wasDynamic }
  }

  function requireBody(body: unknown): Record<string, unknown> {
    if (!isPlainObject(body)) throw new ShapeError('Request body must be an object')
    return body
  }

  function validateAndMergeData(
    bodyData: unknown,
    cached: BuiltDataSchema,
    method: string,
  ): Record<string, unknown> {
    if (bodyData === undefined || bodyData === null) {
      throw new ShapeError(`${method} requires "data" in request body`)
    }
    const validated = cached.schema.parse(bodyData)
    return { ...validated, ...cached.forced }
  }

  function maybeValidateUniqueWhere(
    modelName: string,
    shape: GuardShape,
    method: string,
  ): void {
    if (!UNIQUE_MUTATION_METHODS.has(method)) return
    if (!shape.where) return
    validateUniqueEquality(modelName, shape.where, method, uniqueMap)
  }

  function hasDataRefines(dataConfig: Record<string, true | unknown>): boolean {
    for (const value of Object.values(dataConfig)) {
      if (typeof value === 'function') return true
    }
    return false
  }

  function createGuardedMethods(
    modelName: string,
    modelDelegate: Record<string, (args: any) => any>,
    input: GuardInput,
  ) {
    function callDelegate(method: string, args: any): any {
      if (typeof modelDelegate[method] !== 'function') {
        throw new ShapeError(`Method "${method}" is not available on this model`)
      }
      return modelDelegate[method](args)
    }

    const readShapeCache = new Map<string, BuiltShape>()
    const dataSchemaCache = new Map<string, BuiltDataSchema>()
    const whereBuiltCache = new Map<string, { schema: z.ZodTypeAny | null; forced: Record<string, Record<string, unknown>> }>()
    const projectionCache = new Map<string, BuiltProjection>()

    function getReadShape(
      method: QueryMethod,
      queryShape: Record<string, unknown>,
      matchedKey: string,
      wasDynamic: boolean,
    ): BuiltShape {
      if (!wasDynamic) {
        const cacheKey = `${method}\0${matchedKey}`
        const cached = readShapeCache.get(cacheKey)
        if (cached) return cached
        const built = queryBuilder.buildShapeZodSchema(modelName, method, queryShape as any)
        readShapeCache.set(cacheKey, built)
        return built
      }
      return queryBuilder.buildShapeZodSchema(modelName, method, queryShape as any)
    }

    function getDataSchema(
      mode: 'create' | 'update',
      dataConfig: Record<string, true | unknown>,
      matchedKey: string,
      wasDynamic: boolean,
    ): BuiltDataSchema {
      if (!wasDynamic && !hasDataRefines(dataConfig)) {
        const cacheKey = `${mode}\0${matchedKey}`
        const cached = dataSchemaCache.get(cacheKey)
        if (cached) return cached
        const built = buildDataSchema(modelName, dataConfig, mode)
        dataSchemaCache.set(cacheKey, built)
        return built
      }
      return buildDataSchema(modelName, dataConfig, mode)
    }

    function getWhereBuilt(
      whereConfig: Record<string, Record<string, true | unknown>>,
      matchedKey: string,
      wasDynamic: boolean,
    ): { schema: z.ZodTypeAny | null; forced: Record<string, Record<string, unknown>> } {
      if (!wasDynamic) {
        const cached = whereBuiltCache.get(matchedKey)
        if (cached) return cached
        const built = queryBuilder.buildWhereSchema(modelName, whereConfig)
        whereBuiltCache.set(matchedKey, built)
        return built
      }
      return queryBuilder.buildWhereSchema(modelName, whereConfig)
    }

    function buildProjectionSchema(shape: GuardShape): BuiltProjection {
      if (shape.select && shape.include) {
        throw new ShapeError('Shape cannot define both "select" and "include"')
      }

      const schemaFields: Record<string, z.ZodTypeAny> = {}
      let forcedIncludeTree: Record<string, ForcedTree> = {}
      let forcedSelectTree: Record<string, ForcedTree> = {}
      let forcedIncludeCountWhere: Record<string, Record<string, unknown>> = {}
      let forcedSelectCountWhere: Record<string, Record<string, unknown>> = {}

      if (shape.include) {
        const result = queryBuilder.buildIncludeSchema(
          modelName,
          shape.include as Record<string, true | NestedIncludeArgs>,
        )
        schemaFields['include'] = result.schema
        forcedIncludeTree = result.forcedTree
        forcedIncludeCountWhere = result.forcedCountWhere
      }

      if (shape.select) {
        const result = queryBuilder.buildSelectSchema(
          modelName,
          shape.select as Record<string, true | NestedSelectArgs>,
        )
        schemaFields['select'] = result.schema
        forcedSelectTree = result.forcedTree
        forcedSelectCountWhere = result.forcedCountWhere
      }

      return {
        zodSchema: z.object(schemaFields).strict(),
        forcedIncludeTree,
        forcedSelectTree,
        forcedIncludeCountWhere,
        forcedSelectCountWhere,
      }
    }

    function getProjection(
      shape: GuardShape,
      matchedKey: string,
      wasDynamic: boolean,
    ): BuiltProjection {
      if (!wasDynamic) {
        const cacheKey = `projection\0${matchedKey}`
        const cached = projectionCache.get(cacheKey)
        if (cached) return cached
        const built = buildProjectionSchema(shape)
        projectionCache.set(cacheKey, built)
        return built
      }
      return buildProjectionSchema(shape)
    }

    function resolveProjection(
      shape: GuardShape,
      parsed: Record<string, unknown>,
      method: string,
      matchedKey: string,
      wasDynamic: boolean,
    ): Record<string, unknown> {
      const hasBodyProjection = 'select' in parsed || 'include' in parsed
      const hasShapeProjection = !!shape.select || !!shape.include

      if (hasBodyProjection && !hasShapeProjection) {
        throw new ShapeError(
          `Guard shape does not define "select" or "include" for ${method} return projection`,
        )
      }

      if (!hasShapeProjection) return {}

      const projection = getProjection(shape, matchedKey, wasDynamic)

      const projectionBody: Record<string, unknown> = {}
      if ('select' in parsed) projectionBody.select = parsed.select
      if ('include' in parsed) projectionBody.include = parsed.include

      const validated = projection.zodSchema.parse(projectionBody) as Record<string, unknown>

      if (Object.keys(projection.forcedIncludeTree).length > 0) {
        applyForcedTree(validated, 'include', projection.forcedIncludeTree)
      }
      if (Object.keys(projection.forcedSelectTree).length > 0) {
        applyForcedTree(validated, 'select', projection.forcedSelectTree)
      }
      if (Object.keys(projection.forcedIncludeCountWhere).length > 0) {
        const ic = validated.include as Record<string, unknown> | undefined
        if (ic) applyForcedCountWhere(ic, projection.forcedIncludeCountWhere)
      }
      if (Object.keys(projection.forcedSelectCountWhere).length > 0) {
        const sc = validated.select as Record<string, unknown> | undefined
        if (sc) applyForcedCountWhere(sc, projection.forcedSelectCountWhere)
      }

      return validated
    }

    function buildWhereFromShape(
      shape: GuardShape,
      bodyWhere: unknown,
      preserveUnique: boolean,
      matchedKey: string,
      wasDynamic: boolean,
    ): Record<string, unknown> {
      if (!shape.where) {
        if (bodyWhere !== undefined) {
          throw new ShapeError('Guard shape does not allow "where"')
        }
        return {}
      }

      const built = getWhereBuilt(shape.where, matchedKey, wasDynamic)
      let validatedWhere: Record<string, unknown> | undefined

      if (built.schema) {
        validatedWhere = built.schema.parse(bodyWhere) as Record<string, unknown> | undefined
      }

      if (Object.keys(built.forced).length > 0) {
        return preserveUnique
          ? mergeUniqueForced(validatedWhere, built.forced)
          : mergeForced(validatedWhere, built.forced)
      }

      return validatedWhere ?? {}
    }

    function requireWhere(
      shape: GuardShape,
      bodyWhere: unknown,
      method: string,
      preserveUnique: boolean,
      matchedKey: string,
      wasDynamic: boolean,
    ): Record<string, unknown> {
      const where = buildWhereFromShape(shape, bodyWhere, preserveUnique, matchedKey, wasDynamic)
      if (Object.keys(where).length === 0) {
        throw new ShapeError(`${method} requires a where condition`)
      }
      return where
    }

    function makeReadMethod(method: QueryMethod) {
      return (body?: unknown) => {
        const { shape, body: parsed, matchedKey, wasDynamic } = resolveShape(input, body)
        if (shape.data) {
          throw new ShapeError(`Guard shape "data" is not valid for ${method}`)
        }
        const { data: _, ...queryShape } = shape
        const built = getReadShape(method, queryShape, matchedKey, wasDynamic)
        const isUnique = UNIQUE_READ_METHODS.has(method)
        const args = applyBuiltShape(built, parsed, isUnique)
        if (isUnique && args.where) {
          validateResolvedUniqueWhere(
            modelName,
            args.where as Record<string, unknown>,
            method,
            uniqueMap,
          )
        }
        return callDelegate(method, args)
      }
    }

    function makeCreateMethod(method: string) {
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method)
      const allowedBodyKeys = supportsProjection
        ? ALLOWED_BODY_KEYS_CREATE_PROJECTION
        : ALLOWED_BODY_KEYS_CREATE
      const allowedShapeKeys = supportsProjection
        ? VALID_SHAPE_KEYS_CREATE_PROJECTION
        : VALID_SHAPE_KEYS_CREATE

      return (body: unknown) => {
        const { shape, body: parsed, matchedKey, wasDynamic } = resolveShape(input, body)
        if (!shape.data) throw new ShapeError(`Guard shape requires "data" for ${method}`)
        validateMutationShapeKeys(shape, allowedShapeKeys, method)
        validateMutationBodyKeys(parsed, allowedBodyKeys, method)
        validateCreateCompleteness(modelName, shape.data)
        const dataSchema = getDataSchema('create', shape.data, matchedKey, wasDynamic)

        let args: Record<string, unknown>
        if (method === 'create') {
          const data = validateAndMergeData(parsed.data, dataSchema, method)
          args = { data }
        } else {
          if (!Array.isArray(parsed.data)) throw new ShapeError(`${method} expects data to be an array`)
          if (parsed.data.length === 0) throw new ShapeError(`${method} received empty data array`)
          const data = parsed.data.map((item: unknown) =>
            validateAndMergeData(item, dataSchema, method),
          )
          args = { data }
        }

        if (supportsProjection) {
          const projectionArgs = resolveProjection(shape, parsed, method, matchedKey, wasDynamic)
          Object.assign(args, projectionArgs)
        }

        return callDelegate(method, args)
      }
    }

    function makeUpdateMethod(method: string) {
      const isUniqueWhere = method === 'update'
      const isBulk = BULK_MUTATION_METHODS.has(method)
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method)
      const allowedBodyKeys = supportsProjection
        ? ALLOWED_BODY_KEYS_UPDATE_PROJECTION
        : ALLOWED_BODY_KEYS_UPDATE
      const allowedShapeKeys = supportsProjection
        ? VALID_SHAPE_KEYS_UPDATE_PROJECTION
        : VALID_SHAPE_KEYS_UPDATE

      return (body: unknown) => {
        const { shape, body: parsed, matchedKey, wasDynamic } = resolveShape(input, body)
        if (!shape.data) throw new ShapeError(`Guard shape requires "data" for ${method}`)
        validateMutationShapeKeys(shape, allowedShapeKeys, method)
        validateMutationBodyKeys(parsed, allowedBodyKeys, method)
        if (isBulk && !shape.where) {
          throw new ShapeError(`Guard shape requires "where" for ${method} to prevent unconstrained bulk mutations`)
        }
        maybeValidateUniqueWhere(modelName, shape, method)
        const dataSchema = getDataSchema('update', shape.data, matchedKey, wasDynamic)
        const data = validateAndMergeData(parsed.data, dataSchema, method)
        const where = isUniqueWhere
          ? requireWhere(shape, parsed.where, method, true, matchedKey, wasDynamic)
          : buildWhereFromShape(shape, parsed.where, false, matchedKey, wasDynamic)
        if (isBulk && Object.keys(where).length === 0) {
          throw new ShapeError(`${method} requires at least one where condition`)
        }
        if (isUniqueWhere) {
          validateResolvedUniqueWhere(modelName, where, method, uniqueMap)
        }

        const args: Record<string, unknown> = { data, where }

        if (supportsProjection) {
          const projectionArgs = resolveProjection(shape, parsed, method, matchedKey, wasDynamic)
          Object.assign(args, projectionArgs)
        }

        return callDelegate(method, args)
      }
    }

    function makeDeleteMethod(method: string) {
      const isUniqueWhere = method === 'delete'
      const isBulk = BULK_MUTATION_METHODS.has(method)
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method)
      const allowedBodyKeys = supportsProjection
        ? ALLOWED_BODY_KEYS_DELETE_PROJECTION
        : ALLOWED_BODY_KEYS_DELETE
      const allowedShapeKeys = supportsProjection
        ? VALID_SHAPE_KEYS_DELETE_PROJECTION
        : VALID_SHAPE_KEYS_DELETE

      return (body: unknown) => {
        const { shape, body: parsed, matchedKey, wasDynamic } = resolveShape(input, body)
        if (shape.data) throw new ShapeError(`Guard shape "data" is not valid for ${method}`)
        validateMutationShapeKeys(shape, allowedShapeKeys, method)
        validateMutationBodyKeys(parsed, allowedBodyKeys, method)
        if (isBulk && !shape.where) {
          throw new ShapeError(`Guard shape requires "where" for ${method} to prevent unconstrained bulk mutations`)
        }
        maybeValidateUniqueWhere(modelName, shape, method)
        const where = isUniqueWhere
          ? requireWhere(shape, parsed.where, method, true, matchedKey, wasDynamic)
          : buildWhereFromShape(shape, parsed.where, false, matchedKey, wasDynamic)
        if (isBulk && Object.keys(where).length === 0) {
          throw new ShapeError(`${method} requires at least one where condition`)
        }
        if (isUniqueWhere) {
          validateResolvedUniqueWhere(modelName, where, method, uniqueMap)
        }

        const args: Record<string, unknown> = { where }

        if (supportsProjection) {
          const projectionArgs = resolveProjection(shape, parsed, method, matchedKey, wasDynamic)
          Object.assign(args, projectionArgs)
        }

        return callDelegate(method, args)
      }
    }

    return {
      findMany: makeReadMethod('findMany'),
      findFirst: makeReadMethod('findFirst'),
      findFirstOrThrow: makeReadMethod('findFirstOrThrow'),
      findUnique: makeReadMethod('findUnique'),
      findUniqueOrThrow: makeReadMethod('findUniqueOrThrow'),
      count: makeReadMethod('count'),
      aggregate: makeReadMethod('aggregate'),
      groupBy: makeReadMethod('groupBy'),
      create: makeCreateMethod('create'),
      createMany: makeCreateMethod('createMany'),
      createManyAndReturn: makeCreateMethod('createManyAndReturn'),
      update: makeUpdateMethod('update'),
      updateMany: makeUpdateMethod('updateMany'),
      updateManyAndReturn: makeUpdateMethod('updateManyAndReturn'),
      delete: makeDeleteMethod('delete'),
      deleteMany: makeDeleteMethod('deleteMany'),
    }
  }

  function wrapMethods(
    methods: Record<string, (body?: unknown) => any>,
  ): Record<string, (body?: unknown) => any> {
    const wrapped: Record<string, (body?: unknown) => any> = {}
    for (const [key, fn] of Object.entries(methods)) {
      wrapped[key] = (body?: unknown) => {
        try {
          return fn(body)
        } catch (err) {
          if (err instanceof z.ZodError) {
            throw new ShapeError(
              `Validation failed: ${formatZodError(err)}`,
              { cause: err },
            )
          }
          throw err
        }
      }
    }
    return wrapped
  }

  return {
    $allModels: {
      guard(this: any, input: GuardInput) {
        const modelName: string = this.$name
        const delegateKey = toDelegateKey(modelName)
        const modelDelegate = this.$parent[delegateKey]
        if (!modelDelegate) {
          throw new ShapeError(
            `Could not resolve Prisma delegate for model "${modelName}" (key: "${delegateKey}")`,
          )
        }
        const methods = createGuardedMethods(modelName, modelDelegate, input)
        if (!wrapZodErrors) return methods
        return wrapMethods(methods)
      },
    },
  }
}