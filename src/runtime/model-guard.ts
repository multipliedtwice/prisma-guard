import { z } from 'zod'
import type {
  TypeMap, EnumMap, ZodChains, ZodDefaults, UniqueMap, ScopeMap, GuardShape,
  GuardInput, QueryMethod, GuardedModel,
  NestedIncludeArgs, NestedSelectArgs,
} from '../shared/types.js'
import { ShapeError, formatZodError } from '../shared/errors.js'
import { GUARD_SHAPE_KEYS, toDelegateKey } from '../shared/constants.js'
import { createSchemaBuilder } from './schema-builder.js'
import { createQueryBuilder } from './query-builder.js'
import {
  applyBuiltShape, applyForcedTree, applyForcedCountWhere,
  validateUniqueEquality, validateResolvedUniqueWhere,
  mergeWhereForced, mergeUniqueWhereForced, hasWhereForced,
} from './query-builder-forced.js'
import type { BuiltShape, ForcedTree, WhereForced } from './query-builder-forced.js'
import type { BuiltIncludeResult, BuiltSelectResult } from './query-builder-projection.js'
import type { WhereBuiltResult } from './query-builder-where.js'
import {
  buildDataSchema, validateCreateCompleteness, validateAndMergeData,
  hasDataRefines, validateMutationBodyKeys, validateMutationShapeKeys,
  ALLOWED_BODY_KEYS_CREATE, ALLOWED_BODY_KEYS_CREATE_PROJECTION,
  ALLOWED_BODY_KEYS_CREATE_MANY, ALLOWED_BODY_KEYS_CREATE_MANY_PROJECTION,
  ALLOWED_BODY_KEYS_UPDATE, ALLOWED_BODY_KEYS_UPDATE_PROJECTION,
  ALLOWED_BODY_KEYS_DELETE, ALLOWED_BODY_KEYS_DELETE_PROJECTION,
  VALID_SHAPE_KEYS_CREATE, VALID_SHAPE_KEYS_CREATE_PROJECTION,
  VALID_SHAPE_KEYS_UPDATE, VALID_SHAPE_KEYS_UPDATE_PROJECTION,
  VALID_SHAPE_KEYS_DELETE, VALID_SHAPE_KEYS_DELETE_PROJECTION,
} from './model-guard-data.js'
import type { BuiltDataSchema } from './model-guard-data.js'
import { resolveShape } from './model-guard-resolve.js'
import { validateContext } from './policy.js'

const UNIQUE_MUTATION_METHODS = new Set(['update', 'delete'])
const UNIQUE_READ_METHODS = new Set<string>(['findUnique', 'findUniqueOrThrow'])

const BULK_MUTATION_METHODS = new Set([
  'updateMany', 'updateManyAndReturn', 'deleteMany',
])

const PROJECTION_MUTATION_METHODS = new Set([
  'create', 'update', 'delete',
  'createManyAndReturn', 'updateManyAndReturn',
])

const BATCH_CREATE_METHODS = new Set([
  'createMany', 'createManyAndReturn',
])

interface BuiltProjection {
  zodSchema: z.ZodObject<any>
  forcedIncludeTree: Record<string, ForcedTree>
  forcedSelectTree: Record<string, ForcedTree>
  forcedIncludeCountWhere: Record<string, WhereForced>
  forcedSelectCountWhere: Record<string, WhereForced>
}

export function createModelGuardExtension(config: {
  typeMap: TypeMap
  enumMap: EnumMap
  zodChains: ZodChains
  zodDefaults: ZodDefaults
  uniqueMap: UniqueMap
  scopeMap: ScopeMap
  contextFn: () => Record<string, unknown>
  wrapZodErrors?: boolean
}) {
  const { typeMap, enumMap, zodChains, zodDefaults, uniqueMap, scopeMap, contextFn } = config
  const wrapZodErrors = config.wrapZodErrors ?? false
  const schemaBuilder = createSchemaBuilder(typeMap, zodChains, enumMap)
  const queryBuilder = createQueryBuilder(typeMap, enumMap, uniqueMap)

  const modelScopeFks = new Map<string, Set<string>>()
  for (const [model, entries] of Object.entries(scopeMap)) {
    const fks = new Set<string>()
    for (const entry of entries) fks.add(entry.fk)
    modelScopeFks.set(model, fks)
  }

  function maybeValidateUniqueWhere(
    modelName: string,
    shape: GuardShape,
    method: string,
  ): void {
    if (!UNIQUE_MUTATION_METHODS.has(method)) return
    if (!shape.where) return
    validateUniqueEquality(modelName, shape.where, method, uniqueMap, typeMap)
  }

  function createGuardedMethods(
    modelName: string,
    modelDelegate: Record<string, (args: any) => any>,
    input: GuardInput,
    explicitCaller: string | undefined,
  ) {
    function callDelegate(method: string, args: any): any {
      if (typeof modelDelegate[method] !== 'function') {
        throw new ShapeError(`Method "${method}" is not available on this model`)
      }
      return modelDelegate[method](args)
    }

    function resolveCaller(): string | undefined {
      if (explicitCaller !== undefined) return explicitCaller
      const ctx = validateContext(contextFn())
      const c = ctx.caller
      if (typeof c === 'string') return c
      return undefined
    }

    const readShapeCache = new Map<string, BuiltShape>()
    const dataSchemaCache = new Map<string, BuiltDataSchema>()
    const whereBuiltCache = new Map<string, WhereBuiltResult>()
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
        const built = buildDataSchema(modelName, dataConfig, mode, typeMap, schemaBuilder)
        dataSchemaCache.set(cacheKey, built)
        return built
      }
      return buildDataSchema(modelName, dataConfig, mode, typeMap, schemaBuilder)
    }

    function getWhereBuilt(
      whereConfig: Record<string, unknown>,
      matchedKey: string,
      wasDynamic: boolean,
    ): WhereBuiltResult {
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
      let forcedIncludeCountWhere: Record<string, WhereForced> = {}
      let forcedSelectCountWhere: Record<string, WhereForced> = {}

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

      if (hasWhereForced(built.forced)) {
        return preserveUnique
          ? mergeUniqueWhereForced(validatedWhere, built.forced)
          : mergeWhereForced(validatedWhere, built.forced)
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
        const caller = resolveCaller()
        const resolved = resolveShape(input, body, contextFn, caller)
        if (resolved.shape.data) {
          throw new ShapeError(`Guard shape "data" is not valid for ${method}`)
        }
        const { data: _, ...queryShape } = resolved.shape
        const built = getReadShape(method, queryShape, resolved.matchedKey, resolved.wasDynamic)
        const isUnique = UNIQUE_READ_METHODS.has(method)
        const args = applyBuiltShape(built, resolved.body, isUnique)
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
      const isBatch = BATCH_CREATE_METHODS.has(method)
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method)
      let allowedBodyKeys: Set<string>
      if (isBatch && supportsProjection) {
        allowedBodyKeys = ALLOWED_BODY_KEYS_CREATE_MANY_PROJECTION
      } else if (isBatch) {
        allowedBodyKeys = ALLOWED_BODY_KEYS_CREATE_MANY
      } else if (supportsProjection) {
        allowedBodyKeys = ALLOWED_BODY_KEYS_CREATE_PROJECTION
      } else {
        allowedBodyKeys = ALLOWED_BODY_KEYS_CREATE
      }
      const allowedShapeKeys = supportsProjection ? VALID_SHAPE_KEYS_CREATE_PROJECTION : VALID_SHAPE_KEYS_CREATE

      return (body: unknown) => {
        const caller = resolveCaller()
        const resolved = resolveShape(input, body, contextFn, caller)
        if (!resolved.shape.data) throw new ShapeError(`Guard shape requires "data" for ${method}`)
        validateMutationShapeKeys(resolved.shape as unknown as Record<string, unknown>, allowedShapeKeys, method)
        validateMutationBodyKeys(resolved.body, allowedBodyKeys, method)
        const fks = modelScopeFks.get(modelName) ?? new Set<string>()
        validateCreateCompleteness(modelName, resolved.shape.data, typeMap, fks, zodDefaults)
        const dataSchema = getDataSchema('create', resolved.shape.data, resolved.matchedKey, resolved.wasDynamic)

        let args: Record<string, unknown>
        if (method === 'create') {
          const data = validateAndMergeData(resolved.body.data, dataSchema, method)
          args = { data }
        } else {
          if (!Array.isArray(resolved.body.data)) throw new ShapeError(`${method} expects data to be an array`)
          if (resolved.body.data.length === 0) throw new ShapeError(`${method} received empty data array`)
          const data = resolved.body.data.map((item: unknown) =>
            validateAndMergeData(item, dataSchema, method),
          )
          args = { data }
        }

        if (isBatch && resolved.body.skipDuplicates !== undefined) {
          if (typeof resolved.body.skipDuplicates !== 'boolean') {
            throw new ShapeError(`${method} skipDuplicates must be a boolean`)
          }
          args.skipDuplicates = resolved.body.skipDuplicates
        }

        if (supportsProjection) {
          const projectionArgs = resolveProjection(resolved.shape, resolved.body, method, resolved.matchedKey, resolved.wasDynamic)
          Object.assign(args, projectionArgs)
        }

        return callDelegate(method, args)
      }
    }

    function makeUpdateMethod(method: string) {
      const isUniqueWhere = method === 'update'
      const isBulk = BULK_MUTATION_METHODS.has(method)
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method)
      const allowedBodyKeys = supportsProjection ? ALLOWED_BODY_KEYS_UPDATE_PROJECTION : ALLOWED_BODY_KEYS_UPDATE
      const allowedShapeKeys = supportsProjection ? VALID_SHAPE_KEYS_UPDATE_PROJECTION : VALID_SHAPE_KEYS_UPDATE

      return (body: unknown) => {
        const caller = resolveCaller()
        const resolved = resolveShape(input, body, contextFn, caller)
        if (!resolved.shape.data) throw new ShapeError(`Guard shape requires "data" for ${method}`)
        validateMutationShapeKeys(resolved.shape as unknown as Record<string, unknown>, allowedShapeKeys, method)
        validateMutationBodyKeys(resolved.body, allowedBodyKeys, method)
        if (isBulk && !resolved.shape.where) {
          throw new ShapeError(`Guard shape requires "where" for ${method} to prevent unconstrained bulk mutations`)
        }
        maybeValidateUniqueWhere(modelName, resolved.shape, method)
        const dataSchema = getDataSchema('update', resolved.shape.data, resolved.matchedKey, resolved.wasDynamic)
        const data = validateAndMergeData(resolved.body.data, dataSchema, method)
        const where = isUniqueWhere
          ? requireWhere(resolved.shape, resolved.body.where, method, true, resolved.matchedKey, resolved.wasDynamic)
          : buildWhereFromShape(resolved.shape, resolved.body.where, false, resolved.matchedKey, resolved.wasDynamic)
        if (isBulk && Object.keys(where).length === 0) {
          throw new ShapeError(`${method} requires at least one where condition`)
        }
        if (isUniqueWhere) {
          validateResolvedUniqueWhere(modelName, where, method, uniqueMap)
        }

        const args: Record<string, unknown> = { data, where }

        if (supportsProjection) {
          const projectionArgs = resolveProjection(resolved.shape, resolved.body, method, resolved.matchedKey, resolved.wasDynamic)
          Object.assign(args, projectionArgs)
        }

        return callDelegate(method, args)
      }
    }

    function makeDeleteMethod(method: string) {
      const isUniqueWhere = method === 'delete'
      const isBulk = BULK_MUTATION_METHODS.has(method)
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method)
      const allowedBodyKeys = supportsProjection ? ALLOWED_BODY_KEYS_DELETE_PROJECTION : ALLOWED_BODY_KEYS_DELETE
      const allowedShapeKeys = supportsProjection ? VALID_SHAPE_KEYS_DELETE_PROJECTION : VALID_SHAPE_KEYS_DELETE

      return (body: unknown) => {
        const caller = resolveCaller()
        const resolved = resolveShape(input, body, contextFn, caller)
        if (resolved.shape.data) throw new ShapeError(`Guard shape "data" is not valid for ${method}`)
        validateMutationShapeKeys(resolved.shape as unknown as Record<string, unknown>, allowedShapeKeys, method)
        validateMutationBodyKeys(resolved.body, allowedBodyKeys, method)
        if (isBulk && !resolved.shape.where) {
          throw new ShapeError(`Guard shape requires "where" for ${method} to prevent unconstrained bulk mutations`)
        }
        maybeValidateUniqueWhere(modelName, resolved.shape, method)
        const where = isUniqueWhere
          ? requireWhere(resolved.shape, resolved.body.where, method, true, resolved.matchedKey, resolved.wasDynamic)
          : buildWhereFromShape(resolved.shape, resolved.body.where, false, resolved.matchedKey, resolved.wasDynamic)
        if (isBulk && Object.keys(where).length === 0) {
          throw new ShapeError(`${method} requires at least one where condition`)
        }
        if (isUniqueWhere) {
          validateResolvedUniqueWhere(modelName, where, method, uniqueMap)
        }

        const args: Record<string, unknown> = { where }

        if (supportsProjection) {
          const projectionArgs = resolveProjection(resolved.shape, resolved.body, method, resolved.matchedKey, resolved.wasDynamic)
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
      guard(this: any, input: GuardInput, caller?: string) {
        const modelName: string = this.$name
        const delegateKey = toDelegateKey(modelName)
        const modelDelegate = this.$parent[delegateKey]
        if (!modelDelegate) {
          throw new ShapeError(
            `Could not resolve Prisma delegate for model "${modelName}" (key: "${delegateKey}")`,
          )
        }
        const methods = createGuardedMethods(modelName, modelDelegate, input, caller)
        if (!wrapZodErrors) return methods
        return wrapMethods(methods)
      },
    },
  }
}