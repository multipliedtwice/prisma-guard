import { z } from 'zod'
import type { TypeMap, EnumMap, FieldMeta } from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import { COMBINATOR_KEYS, TO_MANY_RELATION_OPS, TO_ONE_RELATION_OPS } from '../shared/constants.js'
import { createOperatorSchema } from './zod-type-map.js'
import { isPlainObject } from '../shared/is-plain-object.js'
import type { WhereForced } from './query-builder-forced.js'
import { hasWhereForced, mergeWhereForced } from './query-builder-forced.js'

const UNSUPPORTED_WHERE_TYPES = new Set(['Json', 'Bytes'])
const STRING_MODE_OPS = new Set(['contains', 'startsWith', 'endsWith', 'equals'])

export interface WhereBuiltResult {
  schema: z.ZodTypeAny | null
  forced: WhereForced
}

function safeStringify(v: unknown): string {
  if (typeof v === 'bigint') return `${v}n`
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function forcedValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'bigint') return a === b
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags
  }
  if (typeof a !== 'object') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    if (a.length !== (b as unknown[]).length) return false
    return a.every((v, i) => forcedValuesEqual(v, (b as unknown[])[i]))
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(k => k in b && forcedValuesEqual(a[k], b[k]))
}

function mergeScalarConditions(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [field, ops] of Object.entries(source)) {
    const existing = target[field]

    if (existing === undefined) {
      target[field] = ops
      continue
    }

    if (field === 'NOT') {
      const existingArr = Array.isArray(existing) ? existing : [existing]
      const sourceArr = Array.isArray(ops) ? ops : [ops]
      target[field] = [...existingArr, ...sourceArr]
      continue
    }

    if (isPlainObject(existing) && isPlainObject(ops)) {
      for (const [op, val] of Object.entries(ops as Record<string, unknown>)) {
        if (op in (existing as Record<string, unknown>)) {
          const existingVal = (existing as Record<string, unknown>)[op]
          if (!forcedValuesEqual(existingVal, val)) {
            throw new ShapeError(
              `Conflicting forced where values for "${field}.${op}": ` +
              `shape defines both ${safeStringify(existingVal)} and ${safeStringify(val)}`,
            )
          }
        }
      }
      Object.assign(existing, ops)
      continue
    }

    if (!forcedValuesEqual(existing, ops)) {
      throw new ShapeError(
        `Conflicting forced where values for "${field}"`,
      )
    }
  }
}

function mergeRelationForcedMaps(
  target: Record<string, Record<string, WhereForced>>,
  source: Record<string, Record<string, WhereForced>>,
): void {
  for (const [relName, ops] of Object.entries(source)) {
    if (!target[relName]) {
      target[relName] = ops
      continue
    }
    for (const [op, forced] of Object.entries(ops)) {
      if (!target[relName][op]) {
        target[relName][op] = forced
      } else {
        mergeScalarConditions(target[relName][op].conditions, forced.conditions)
        mergeRelationForcedMaps(target[relName][op].relations, forced.relations)
      }
    }
  }
}

export function createWhereBuilder(typeMap: TypeMap, enumMap: EnumMap) {
  function buildWhereSchema(
    model: string,
    whereConfig: Record<string, unknown>,
  ): WhereBuiltResult {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    const scalarConditions: Record<string, unknown> = {}
    const relationForced: Record<string, Record<string, WhereForced>> = {}

    for (const [key, value] of Object.entries(whereConfig)) {
      if (COMBINATOR_KEYS.has(key)) {
        processCombinator(
          key as 'AND' | 'OR' | 'NOT',
          value,
          model,
          fieldSchemas,
          scalarConditions,
          relationForced,
        )
        continue
      }

      const fieldMeta = modelFields[key]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${key}" on model "${model}"`)

      if (fieldMeta.isRelation) {
        processRelationFilter(
          key,
          value,
          fieldMeta,
          fieldSchemas,
          relationForced,
        )
        continue
      }

      if (UNSUPPORTED_WHERE_TYPES.has(fieldMeta.type) && !fieldMeta.isList) {
        throw new ShapeError(
          `${fieldMeta.type} field "${key}" cannot be used in where filters`,
        )
      }

      processScalarField(key, value, model, fieldMeta, fieldSchemas, scalarConditions)
    }

    const schema = Object.keys(fieldSchemas).length > 0
      ? z.object(fieldSchemas).strict().optional()
      : null

    return {
      schema,
      forced: {
        conditions: scalarConditions,
        relations: relationForced,
      },
    }
  }

  function processCombinator(
    key: 'AND' | 'OR' | 'NOT',
    value: unknown,
    model: string,
    fieldSchemas: Record<string, z.ZodTypeAny>,
    parentConditions: Record<string, unknown>,
    parentRelations: Record<string, Record<string, WhereForced>>,
  ): void {
    if (!isPlainObject(value)) {
      throw new ShapeError(`"${key}" in where shape must be an object defining allowed fields`)
    }

    const result = buildWhereSchema(model, value)

    if (result.schema) {
      if (key === 'NOT') {
        fieldSchemas[key] = z.union([result.schema, z.array(result.schema)]).optional()
      } else {
        fieldSchemas[key] = z.array(result.schema).optional()
      }
    }

    if (hasWhereForced(result.forced)) {
      if (key === 'AND' || key === 'OR') {
        mergeScalarConditions(parentConditions, result.forced.conditions)
        mergeRelationForcedMaps(parentRelations, result.forced.relations)
      } else {
        const notWhere = mergeWhereForced(undefined, result.forced)
        if (Object.keys(notWhere).length > 0) {
          const existing = parentConditions[key]
          if (existing) {
            parentConditions[key] = Array.isArray(existing)
              ? [...existing, notWhere]
              : [existing, notWhere]
          } else {
            parentConditions[key] = notWhere
          }
        }
      }
    }
  }

  function processRelationFilter(
    key: string,
    value: unknown,
    fieldMeta: FieldMeta,
    fieldSchemas: Record<string, z.ZodTypeAny>,
    parentRelations: Record<string, Record<string, WhereForced>>,
  ): void {
    if (!isPlainObject(value)) {
      throw new ShapeError(`Relation filter for "${key}" must be an object with operators (some, every, none, is, isNot)`)
    }

    const allowedOps = fieldMeta.isList ? TO_MANY_RELATION_OPS : TO_ONE_RELATION_OPS

    const opSchemas: Record<string, z.ZodTypeAny> = {}
    const opForced: Record<string, WhereForced> = {}
    let hasClientOps = false

    for (const [op, opValue] of Object.entries(value)) {
      if (!allowedOps.has(op)) {
        const allowed = [...allowedOps].join(', ')
        throw new ShapeError(
          `Operator "${op}" not supported for ${fieldMeta.isList ? 'to-many' : 'to-one'} relation "${key}". Allowed: ${allowed}`,
        )
      }

      if (!isPlainObject(opValue)) {
        throw new ShapeError(
          `Relation filter operator "${op}" on "${key}" must be an object defining nested where fields`,
        )
      }

      const nested = buildWhereSchema(fieldMeta.type, opValue)

      if (nested.schema) {
        if (!hasWhereForced(nested.forced)) {
          opSchemas[op] = nested.schema.refine(
            (v: any) => v === undefined || Object.keys(v).length > 0,
            { message: `Relation filter "${key}.${op}" requires at least one condition` },
          )
        } else {
          opSchemas[op] = nested.schema
        }
        hasClientOps = true
      }

      if (hasWhereForced(nested.forced)) {
        opForced[op] = nested.forced
      }
    }

    if (hasClientOps) {
      const clientOpKeys = Object.keys(opSchemas)
      const opObjSchema = z.object(opSchemas).strict()

      if (Object.keys(opForced).length === 0) {
        fieldSchemas[key] = opObjSchema
          .refine(
            (v) => clientOpKeys.some(k => (v as Record<string, unknown>)[k] !== undefined),
            { message: `At least one relation operator required for "${key}"` },
          )
          .optional()
      } else {
        fieldSchemas[key] = opObjSchema.optional()
      }
    }

    if (Object.keys(opForced).length > 0) {
      parentRelations[key] = opForced
    }
  }

  function processScalarField(
    fieldName: string,
    operators: unknown,
    model: string,
    fieldMeta: FieldMeta,
    fieldSchemas: Record<string, z.ZodTypeAny>,
    scalarConditions: Record<string, unknown>,
  ): void {
    if (!isPlainObject(operators)) {
      throw new ShapeError(
        `Where config for scalar field "${fieldName}" on model "${model}" must be an object of operators`,
      )
    }

    const opSchemas: Record<string, z.ZodTypeAny> = {}
    const fieldForced: Record<string, unknown> = {}
    let hasClientOps = false
    let hasStringModeOp = false
    const clientOpKeys: string[] = []

    for (const [op, opValue] of Object.entries(operators)) {
      if (opValue === true) {
        opSchemas[op] = createOperatorSchema(fieldMeta, op, enumMap).optional()
        hasClientOps = true
        clientOpKeys.push(op)
        if (fieldMeta.type === 'String' && !fieldMeta.isList && STRING_MODE_OPS.has(op)) {
          hasStringModeOp = true
        }
      } else {
        const opSchema = createOperatorSchema(fieldMeta, op, enumMap)
        let parsed: unknown
        try {
          parsed = opSchema.parse(opValue)
        } catch (err: any) {
          throw new ShapeError(
            `Invalid forced value for "${model}.${fieldName}.${op}": ${err.message}`,
          )
        }
        fieldForced[op] = parsed
      }
    }

    if (!hasClientOps && Object.keys(fieldForced).length === 0) {
      throw new ShapeError(
        `Empty operator config for where field "${fieldName}" on model "${model}". Define at least one operator.`,
      )
    }

    if (hasStringModeOp) {
      opSchemas['mode'] = z.enum(['default', 'insensitive']).optional()
    }

    if (hasClientOps) {
      const opObj = z.object(opSchemas).strict()
      fieldSchemas[fieldName] = opObj
        .refine(
          (v) => clientOpKeys.some(k => (v as Record<string, unknown>)[k] !== undefined),
          { message: `At least one operator required for where field "${fieldName}"` },
        )
        .optional()
    }

    if (Object.keys(fieldForced).length > 0) {
      scalarConditions[fieldName] = fieldForced
    }
  }

  return { buildWhereSchema }
}