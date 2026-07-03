import { z } from 'zod'
import type {
  TypeMap,
  EnumMap,
  NestedArgs,
  OrderByFieldConfig,
} from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import { isPlainObject } from '../shared/utils.js'
import { deepClone } from '../shared/deep-clone.js'
import { buildRelationArgsSkeleton } from '../shared/projection-defaults.js'
import type { WhereForced, ForcedTree } from './query-builder-forced.js'
import { hasWhereForced } from './query-builder-forced.js'
import type { WhereBuiltResult } from './query-builder-where.js'
import { strictObjectRequiringOne } from '../shared/zod-helpers.js'

type ProjectionMode = 'include' | 'select'

const KNOWN_NESTED_KEYS: Record<ProjectionMode, Set<string>> = {
  include: new Set(['where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip']),
  select: new Set(['select', 'include', 'where', 'orderBy', 'cursor', 'take', 'skip']),
}

const KNOWN_COUNT_SELECT_ENTRY_KEYS = new Set(['where'])
const MAX_PROJECTION_DEPTH = 10

export interface BuiltProjectionResult {
  schema: z.ZodTypeAny
  forcedTree: Record<string, ForcedTree>
  forcedCountWhere: Record<string, WhereForced>
}

export type BuiltIncludeResult = BuiltProjectionResult
export type BuiltSelectResult = BuiltProjectionResult

interface ProjectionDeps {
  buildWhereSchema(model: string, config: Record<string, unknown>): WhereBuiltResult
  buildOrderBySchema(model: string, config: Record<string, OrderByFieldConfig>): z.ZodTypeAny
  buildCursorSchema(model: string, config: Record<string, unknown>): z.ZodTypeAny
  buildTakeSchema(config: number | { max: number; default?: number }): z.ZodTypeAny
}

function validateNestedKeys(
  keys: Iterable<string>,
  allowed: Set<string>,
  context: string,
): void {
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new ShapeError(
        `Unknown key "${key}" in ${context}. Allowed: ${[...allowed].join(', ')}`,
      )
    }
  }
}

function hasDefinedKeys(v: Record<string, unknown>): boolean {
  return Object.values(v).some((value) => value !== undefined)
}

function wrapRelationSchema(
  nestedObj: z.ZodTypeAny,
  skeleton: Record<string, unknown>,
): z.ZodTypeAny {
  const collapsed = nestedObj.transform((v) =>
    isPlainObject(v) && !hasDefinedKeys(v) ? true : v,
  )

  return z.preprocess(
    (v) => (v === true ? deepClone(skeleton) : v),
    collapsed,
  )
}

export function createProjectionBuilder(
  typeMap: TypeMap,
  _enumMap: EnumMap,
  deps: ProjectionDeps,
) {
  function buildIncludeCountSchema(
    model: string,
    config: true | Record<string, unknown>,
  ): { schema: z.ZodTypeAny; forcedCountWhere: Record<string, WhereForced> } {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    if (config === true) {
      return { schema: z.literal(true).optional(), forcedCountWhere: {} }
    }

    if (!isPlainObject(config) || !('select' in config)) {
      throw new ShapeError(
        `Invalid _count config on model "${model}". Expected true or { select: { ... } }`,
      )
    }

    for (const key of Object.keys(config)) {
      if (key !== 'select') {
        throw new ShapeError(
          `Unknown key "${key}" in _count config on model "${model}". Only "select" is allowed.`,
        )
      }
    }

    if (!isPlainObject(config.select)) {
      throw new ShapeError(
        `Invalid _count.select on model "${model}". Expected a plain object with relation field keys.`,
      )
    }

    const selectObj = config.select as Record<string, true | Record<string, unknown>>

    if (Object.keys(selectObj).length === 0) {
      throw new ShapeError(
        `Empty _count.select on model "${model}". Define at least one relation field.`,
      )
    }

    const countSelectFields: Record<string, z.ZodTypeAny> = {}
    const forcedCountWhere: Record<string, WhereForced> = {}

    for (const [fieldName, fieldConfig] of Object.entries(selectObj)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in _count.select`)
      if (!fieldMeta.isRelation) throw new ShapeError(`Field "${fieldName}" is not a relation on model "${model}" in _count.select`)
      if (!fieldMeta.isList) throw new ShapeError(`Field "${fieldName}" is a to-one relation on model "${model}" in _count.select. Only to-many relations support _count.`)

      if (fieldConfig === true) {
        countSelectFields[fieldName] = z.literal(true).optional()
        continue
      }

      if (!isPlainObject(fieldConfig)) {
        throw new ShapeError(
          `Invalid config for _count.select.${fieldName} on model "${model}". Expected true or { where: { ... } }`,
        )
      }

      if (Object.keys(fieldConfig).length === 0) {
        throw new ShapeError(
          `Empty config for _count.select.${fieldName} on model "${model}". Use true or { where: { ... } }.`,
        )
      }

      validateNestedKeys(
        Object.keys(fieldConfig),
        KNOWN_COUNT_SELECT_ENTRY_KEYS,
        `_count.select.${fieldName} on model "${model}"`,
      )

      if (fieldConfig.where) {
        const relatedType = fieldMeta.type
        const { schema: whereSchema, forced } = deps.buildWhereSchema(
          relatedType,
          fieldConfig.where as Record<string, unknown>,
        )
        const nestedSchemas: Record<string, z.ZodTypeAny> = {}
        if (whereSchema) nestedSchemas['where'] = whereSchema
        const nestedObj = z.object(nestedSchemas).strict()
        countSelectFields[fieldName] = z.union([z.literal(true), nestedObj]).optional()

        if (hasWhereForced(forced)) {
          forcedCountWhere[fieldName] = forced
        }
      } else {
        countSelectFields[fieldName] = z.literal(true).optional()
      }
    }

    const selectSchema = strictObjectRequiringOne(
      countSelectFields,
      '_count.select must specify at least one field',
    )

    return {
      schema: z.object({ select: selectSchema }).strict().optional(),
      forcedCountWhere,
    }
  }

  function buildNestedRelSchemas(
    relatedType: string,
    config: NestedArgs,
    depth: number,
  ): { nestedSchemas: Record<string, z.ZodTypeAny>; relForced: ForcedTree } {
    const nestedSchemas: Record<string, z.ZodTypeAny> = {}
    const relForced: ForcedTree = {}

    if (config.where) {
      const { schema: whereSchema, forced } = deps.buildWhereSchema(
        relatedType,
        config.where as Record<string, unknown>,
      )
      if (whereSchema) nestedSchemas['where'] = whereSchema
      if (hasWhereForced(forced)) relForced.where = forced
    }

    if (config.include) {
      const nested = buildProjectionSchema('include', relatedType, config.include, depth + 1)
      nestedSchemas['include'] = nested.schema
      if (Object.keys(nested.forcedTree).length > 0) relForced.include = nested.forcedTree
      if (Object.keys(nested.forcedCountWhere).length > 0) {
        relForced._countWhere = nested.forcedCountWhere
        relForced._countWherePlacement = 'include'
      }
    }

    if (config.select) {
      const nested = buildProjectionSchema('select', relatedType, config.select, depth + 1)
      nestedSchemas['select'] = nested.schema
      if (Object.keys(nested.forcedTree).length > 0) relForced.select = nested.forcedTree
      if (Object.keys(nested.forcedCountWhere).length > 0) {
        relForced._countWhere = nested.forcedCountWhere
        relForced._countWherePlacement = 'select'
      }
    }

    if (config.orderBy) {
      nestedSchemas['orderBy'] = deps.buildOrderBySchema(relatedType, config.orderBy)
    }
    if (config.cursor) {
      nestedSchemas['cursor'] = deps.buildCursorSchema(relatedType, config.cursor)
    }
    if (config.take) {
      nestedSchemas['take'] = deps.buildTakeSchema(config.take)
    }
    if (config.skip) {
      nestedSchemas['skip'] = z.number().int().min(0).optional()
    }

    return { nestedSchemas, relForced }
  }

  function buildProjectionSchema(
    mode: ProjectionMode,
    model: string,
    projectionConfig: Record<string, true | NestedArgs>,
    depth?: number,
  ): BuiltProjectionResult {
    const currentDepth = depth ?? 0
    if (currentDepth > MAX_PROJECTION_DEPTH) {
      throw new ShapeError(
        `${mode === 'include' ? 'Include' : 'Select'} schema for model "${model}" exceeds maximum nesting depth (${MAX_PROJECTION_DEPTH}). Check for circular relation references in the shape.`,
      )
    }

    if (Object.keys(projectionConfig).length === 0) {
      throw new ShapeError(
        `Empty ${mode} config on model "${model}". Define at least one ${mode === 'include' ? 'relation' : 'field'}.`,
      )
    }

    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const allowedNestedKeys = KNOWN_NESTED_KEYS[mode]
    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    const forcedTree: Record<string, ForcedTree> = {}
    let topLevelForcedCountWhere: Record<string, WhereForced> = {}

    for (const [fieldName, config] of Object.entries(projectionConfig)) {
      if (fieldName === '_count') {
        const countResult = buildIncludeCountSchema(model, config as true | Record<string, unknown>)
        fieldSchemas['_count'] = countResult.schema
        topLevelForcedCountWhere = countResult.forcedCountWhere
        continue
      }

      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)

      if (mode === 'include' && !fieldMeta.isRelation) {
        throw new ShapeError(`Field "${fieldName}" is not a relation on model "${model}"`)
      }

      if (config === true) {
        fieldSchemas[fieldName] = z.literal(true).optional()
        continue
      }

      if (mode === 'select' && !fieldMeta.isRelation) {
        throw new ShapeError(`Nested select args only valid for relations, not scalar "${fieldName}" on model "${model}"`)
      }

      const contextLabel = `nested ${mode} for "${fieldName}" on model "${model}"`
      validateNestedKeys(Object.keys(config), allowedNestedKeys, contextLabel)

      if (config.select && config.include) {
        throw new ShapeError(`Nested ${mode} for "${fieldName}" cannot define both "select" and "include".`)
      }

      if (!fieldMeta.isList) {
        if (config.where || config.orderBy || config.cursor || config.take || config.skip) {
          throw new ShapeError(
            `Relation "${fieldName}" on model "${model}" is to-one. Only "select" and "include" are supported for to-one nested reads, not where/orderBy/cursor/take/skip.`,
          )
        }
      }

      const { nestedSchemas, relForced } = buildNestedRelSchemas(fieldMeta.type, config, currentDepth)
      const nestedObj = z.object(nestedSchemas).strict()

      fieldSchemas[fieldName] = wrapRelationSchema(
        nestedObj,
        buildRelationArgsSkeleton(config),
      ).optional()

      if (Object.keys(relForced).length > 0) forcedTree[fieldName] = relForced
    }

    const schema =
      Object.keys(fieldSchemas).length > 0
        ? strictObjectRequiringOne(
            fieldSchemas,
            `${mode} must specify at least one field`,
          ).optional()
        : z.object(fieldSchemas).strict().optional()

    return {
      schema,
      forcedTree,
      forcedCountWhere: topLevelForcedCountWhere,
    }
  }

  function buildIncludeSchema(
    model: string,
    includeConfig: Record<string, true | NestedArgs>,
    depth?: number,
  ): BuiltIncludeResult {
    return buildProjectionSchema('include', model, includeConfig, depth)
  }

  function buildSelectSchema(
    model: string,
    selectConfig: Record<string, true | NestedArgs>,
    depth?: number,
  ): BuiltSelectResult {
    return buildProjectionSchema('select', model, selectConfig, depth)
  }

  return { buildIncludeSchema, buildSelectSchema, buildIncludeCountSchema, buildProjectionSchema }
}