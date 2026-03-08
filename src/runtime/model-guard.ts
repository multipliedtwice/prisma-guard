import { z } from 'zod'
import type {
  TypeMap, EnumMap, ZodChains, UniqueMap, ScopeMap, GuardShape,
  GuardInput, GuardShapeOrFn, QueryMethod, GuardedModel, DataFieldRefine,
} from '../shared/types.js'
import { ShapeError, CallerError } from '../shared/errors.js'
import { GUARD_SHAPE_KEYS } from '../shared/constants.js'
import { matchCallerPattern } from '../shared/match-caller.js'
import { createSchemaBuilder } from './schema-builder.js'
import {
  createQueryBuilder, isPlainObject, mergeForced, mergeUniqueForced,
  applyBuiltShape, validateUniqueEquality, validateResolvedUniqueWhere,
} from './query-builder.js'
import type { BuiltShape } from './query-builder.js'

const ALLOWED_BODY_KEYS_CREATE = new Set(['data'])
const ALLOWED_BODY_KEYS_UPDATE = new Set(['data', 'where'])
const ALLOWED_BODY_KEYS_DELETE = new Set(['where'])

const VALID_SHAPE_KEYS_CREATE = new Set(['data'])
const VALID_SHAPE_KEYS_UPDATE = new Set(['data', 'where'])
const VALID_SHAPE_KEYS_DELETE = new Set(['where'])

interface BuiltDataSchema {
  schema: z.ZodObject<any>
  forced: Record<string, unknown>
}

const UNIQUE_MUTATION_METHODS = new Set(['update', 'delete'])

const UNIQUE_READ_METHODS = new Set<string>(['findUnique', 'findUniqueOrThrow'])

const BULK_MUTATION_METHODS = new Set([
  'updateMany', 'updateManyAndReturn', 'deleteMany',
])

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

function formatZodError(err: z.ZodError): string {
  return err.issues.map(i => {
    const p = i.path.length > 0 ? `${i.path.join('.')}: ` : ''
    return `${p}${i.message}`
  }).join('; ')
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
        let fieldSchema: z.ZodTypeAny
        try {
          fieldSchema = (value as DataFieldRefine)(baseSchema)
        } catch (err: any) {
          throw new ShapeError(
            `Invalid inline refine for "${model}.${fieldName}": ${err.message}`,
            { cause: err },
          )
        }

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

  function resolveShape(
    input: GuardInput,
    body: unknown,
  ): ResolvedShape {
    if (isSingleShape(input)) {
      const wasDynamic = typeof input === 'function'
      const shape = wasDynamic
        ? (input as (ctx: any) => GuardShape)(contextFn())
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
      ? (shapeOrFn as (ctx: any) => GuardShape)(contextFn())
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
      return (body: unknown) => {
        const { shape, body: parsed, matchedKey, wasDynamic } = resolveShape(input, body)
        if (!shape.data) throw new ShapeError(`Guard shape requires "data" for ${method}`)
        validateMutationShapeKeys(shape, VALID_SHAPE_KEYS_CREATE, method)
        validateMutationBodyKeys(parsed, ALLOWED_BODY_KEYS_CREATE, method)
        validateCreateCompleteness(modelName, shape.data)
        const dataSchema = getDataSchema('create', shape.data, matchedKey, wasDynamic)
        if (method === 'create') {
          const data = validateAndMergeData(parsed.data, dataSchema, method)
          return callDelegate('create', { data })
        }
        if (!Array.isArray(parsed.data)) throw new ShapeError(`${method} expects data to be an array`)
        if (parsed.data.length === 0) throw new ShapeError(`${method} received empty data array`)
        const data = parsed.data.map((item: unknown) =>
          validateAndMergeData(item, dataSchema, method),
        )
        return callDelegate(method, { data })
      }
    }

    function makeUpdateMethod(method: string) {
      const isUniqueWhere = method === 'update'
      const isBulk = BULK_MUTATION_METHODS.has(method)
      return (body: unknown) => {
        const { shape, body: parsed, matchedKey, wasDynamic } = resolveShape(input, body)
        if (!shape.data) throw new ShapeError(`Guard shape requires "data" for ${method}`)
        validateMutationShapeKeys(shape, VALID_SHAPE_KEYS_UPDATE, method)
        validateMutationBodyKeys(parsed, ALLOWED_BODY_KEYS_UPDATE, method)
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
        return callDelegate(method, { data, where })
      }
    }

    function makeDeleteMethod(method: string) {
      const isUniqueWhere = method === 'delete'
      const isBulk = BULK_MUTATION_METHODS.has(method)
      return (body: unknown) => {
        const { shape, body: parsed, matchedKey, wasDynamic } = resolveShape(input, body)
        if (shape.data) throw new ShapeError(`Guard shape "data" is not valid for ${method}`)
        validateMutationShapeKeys(shape, VALID_SHAPE_KEYS_DELETE, method)
        validateMutationBodyKeys(parsed, ALLOWED_BODY_KEYS_DELETE, method)
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
        return callDelegate(method, { where })
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
        const delegateKey = modelName[0].toLowerCase() + modelName.slice(1)
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