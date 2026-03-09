import { z } from 'zod'
import type { TypeMap, EnumMap, UniqueMap, NestedIncludeArgs, NestedSelectArgs } from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import { isPlainObject } from '../shared/is-plain-object.js'
import type { WhereForced, ForcedTree } from './query-builder-forced.js'
import { hasWhereForced } from './query-builder-forced.js'
import type { WhereBuiltResult } from './query-builder-where.js'

const KNOWN_NESTED_INCLUDE_KEYS = new Set([
  'where', 'include', 'select', 'orderBy', 'cursor', 'take', 'skip',
])
const KNOWN_NESTED_SELECT_KEYS = new Set([
  'select', 'where', 'orderBy', 'cursor', 'take', 'skip',
])
const KNOWN_COUNT_SELECT_ENTRY_KEYS = new Set(['where'])

export interface BuiltIncludeResult {
  schema: z.ZodTypeAny
  forcedTree: Record<string, ForcedTree>
  forcedCountWhere: Record<string, WhereForced>
}

export interface BuiltSelectResult {
  schema: z.ZodTypeAny
  forcedTree: Record<string, ForcedTree>
  forcedCountWhere: Record<string, WhereForced>
}

interface ProjectionDeps {
  buildWhereSchema(model: string, config: Record<string, unknown>): WhereBuiltResult
  buildOrderBySchema(model: string, config: Record<string, true>): z.ZodTypeAny
  buildCursorSchema(model: string, config: Record<string, true>): z.ZodTypeAny
  buildTakeSchema(config: { max: number; default?: number }): z.ZodTypeAny
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

export function createProjectionBuilder(
  typeMap: TypeMap,
  enumMap: EnumMap,
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
      } else if (isPlainObject(fieldConfig)) {
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
      } else {
        throw new ShapeError(
          `Invalid config for _count.select.${fieldName} on model "${model}". Expected true or { where: { ... } }`,
        )
      }
    }

    const selectSchema = z.object(countSelectFields).strict()
    return {
      schema: z.object({ select: selectSchema }).strict().optional(),
      forcedCountWhere,
    }
  }

  function buildIncludeSchema(
    model: string,
    includeConfig: Record<string, true | NestedIncludeArgs>,
  ): BuiltIncludeResult {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    const forcedTree: Record<string, ForcedTree> = {}
    let topLevelForcedCountWhere: Record<string, WhereForced> = {}

    for (const [relName, config] of Object.entries(includeConfig)) {
      if (relName === '_count') {
        const countResult = buildIncludeCountSchema(model, config as true | Record<string, unknown>)
        fieldSchemas['_count'] = countResult.schema
        topLevelForcedCountWhere = countResult.forcedCountWhere
        continue
      }

      const fieldMeta = modelFields[relName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${relName}" on model "${model}"`)
      if (!fieldMeta.isRelation) throw new ShapeError(`Field "${relName}" is not a relation on model "${model}"`)

      if (config === true) {
        fieldSchemas[relName] = z.literal(true).optional()
      } else {
        validateNestedKeys(
          Object.keys(config),
          KNOWN_NESTED_INCLUDE_KEYS,
          `nested include for "${relName}" on model "${model}"`,
        )

        if (config.select && config.include) {
          throw new ShapeError(`Nested include for "${relName}" cannot define both "select" and "include".`)
        }

        if (!fieldMeta.isList) {
          if (config.where || config.orderBy || config.cursor || config.take || config.skip) {
            throw new ShapeError(
              `Relation "${relName}" on model "${model}" is to-one. Only "include" and "select" are supported for to-one nested reads, not where/orderBy/cursor/take/skip.`,
            )
          }
        }

        const nestedSchemas: Record<string, z.ZodTypeAny> = {}
        const relForced: ForcedTree = {}

        if (config.where) {
          const { schema: whereSchema, forced } = deps.buildWhereSchema(
            fieldMeta.type,
            config.where as Record<string, unknown>,
          )
          if (whereSchema) nestedSchemas['where'] = whereSchema
          if (hasWhereForced(forced)) relForced.where = forced
        }
        if (config.include) {
          const nested = buildIncludeSchema(fieldMeta.type, config.include)
          nestedSchemas['include'] = nested.schema
          if (Object.keys(nested.forcedTree).length > 0) relForced.include = nested.forcedTree
          if (Object.keys(nested.forcedCountWhere).length > 0) relForced._countWhere = nested.forcedCountWhere
        }
        if (config.select) {
          const nested = buildSelectSchema(fieldMeta.type, config.select)
          nestedSchemas['select'] = nested.schema
          if (Object.keys(nested.forcedTree).length > 0) relForced.select = nested.forcedTree
          if (Object.keys(nested.forcedCountWhere).length > 0) relForced._countWhere = nested.forcedCountWhere
        }
        if (config.orderBy) {
          nestedSchemas['orderBy'] = deps.buildOrderBySchema(fieldMeta.type, config.orderBy)
        }
        if (config.cursor) {
          nestedSchemas['cursor'] = deps.buildCursorSchema(fieldMeta.type, config.cursor)
        }
        if (config.take) {
          nestedSchemas['take'] = deps.buildTakeSchema(config.take)
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
      forcedCountWhere: topLevelForcedCountWhere,
    }
  }

  function buildSelectSchema(
    model: string,
    selectConfig: Record<string, true | NestedSelectArgs>,
  ): BuiltSelectResult {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    const forcedTree: Record<string, ForcedTree> = {}
    let topLevelForcedCountWhere: Record<string, WhereForced> = {}

    for (const [fieldName, config] of Object.entries(selectConfig)) {
      if (fieldName === '_count') {
        const countResult = buildIncludeCountSchema(model, config as true | Record<string, unknown>)
        fieldSchemas['_count'] = countResult.schema
        topLevelForcedCountWhere = countResult.forcedCountWhere
        continue
      }

      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)

      if (config === true) {
        fieldSchemas[fieldName] = z.literal(true).optional()
      } else {
        if (!fieldMeta.isRelation) {
          throw new ShapeError(`Nested select args only valid for relations, not scalar "${fieldName}" on model "${model}"`)
        }

        validateNestedKeys(
          Object.keys(config),
          KNOWN_NESTED_SELECT_KEYS,
          `nested select for "${fieldName}" on model "${model}"`,
        )

        if (!fieldMeta.isList) {
          if (config.where || config.orderBy || config.cursor || config.take || config.skip) {
            throw new ShapeError(
              `Relation "${fieldName}" on model "${model}" is to-one. Only "select" is supported for to-one nested reads, not where/orderBy/cursor/take/skip.`,
            )
          }
        }

        const nestedSchemas: Record<string, z.ZodTypeAny> = {}
        const relForced: ForcedTree = {}

        if (config.select) {
          const nested = buildSelectSchema(fieldMeta.type, config.select)
          nestedSchemas['select'] = nested.schema
          if (Object.keys(nested.forcedTree).length > 0) relForced.select = nested.forcedTree
          if (Object.keys(nested.forcedCountWhere).length > 0) relForced._countWhere = nested.forcedCountWhere
        }
        if (config.where) {
          const { schema: whereSchema, forced } = deps.buildWhereSchema(
            fieldMeta.type,
            config.where as Record<string, unknown>,
          )
          if (whereSchema) nestedSchemas['where'] = whereSchema
          if (hasWhereForced(forced)) relForced.where = forced
        }
        if (config.orderBy) {
          nestedSchemas['orderBy'] = deps.buildOrderBySchema(fieldMeta.type, config.orderBy)
        }
        if (config.cursor) {
          nestedSchemas['cursor'] = deps.buildCursorSchema(fieldMeta.type, config.cursor)
        }
        if (config.take) {
          nestedSchemas['take'] = deps.buildTakeSchema(config.take)
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
      forcedCountWhere: topLevelForcedCountWhere,
    }
  }

  return { buildIncludeSchema, buildSelectSchema, buildIncludeCountSchema }
}