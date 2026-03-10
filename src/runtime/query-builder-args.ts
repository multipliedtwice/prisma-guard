import { z } from 'zod'
import type { TypeMap, EnumMap, UniqueMap } from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import { createBaseType, getSupportedOperators, createOperatorSchema, NUMERIC_TYPES, COMPARABLE_TYPES } from './zod-type-map.js'
import type { ScalarBaseMap } from '../shared/scalar-base.js'

const UNSUPPORTED_BY_TYPES = new Set(['Json', 'Bytes'])

function requireConfigTrue(config: Record<string, unknown>, context: string): void {
  for (const [key, value] of Object.entries(config)) {
    if (value !== true) {
      throw new ShapeError(
        `Config value for "${key}" in ${context} must be true, got ${typeof value}`,
      )
    }
  }
}

export function createArgsBuilder(
  typeMap: TypeMap,
  enumMap: EnumMap,
  uniqueMap: UniqueMap,
  scalarBase: ScalarBaseMap,
) {
  function buildOrderBySchema(
    model: string,
    orderByConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    requireConfigTrue(orderByConfig, `orderBy on model "${model}"`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}

    for (const fieldName of Object.keys(orderByConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in orderBy`)
      if (fieldMeta.type === 'Json') throw new ShapeError(`Json field "${fieldName}" cannot be used in orderBy`)
      if (fieldMeta.isList) throw new ShapeError(`List field "${fieldName}" cannot be used in orderBy`)

      fieldSchemas[fieldName] = z.enum(['asc', 'desc']).optional()
    }

    const fieldKeys = Object.keys(fieldSchemas)
    const singleSchema = z.object(fieldSchemas).strict().refine(
      (v) => fieldKeys.some(k => (v as Record<string, unknown>)[k] !== undefined),
      { message: 'orderBy must specify at least one field' },
    )
    return z.union([singleSchema, z.array(singleSchema).min(1)]).optional()
  }

  function buildTakeSchema(config: { max: number; default?: number }): z.ZodTypeAny {
    if (!Number.isFinite(config.max) || !Number.isInteger(config.max)) {
      throw new ShapeError(`take max must be a finite integer, got ${config.max}`)
    }
    if (config.max < 1) {
      throw new ShapeError(`take max must be at least 1, got ${config.max}`)
    }
    if (config.default !== undefined) {
      if (!Number.isFinite(config.default) || !Number.isInteger(config.default)) {
        throw new ShapeError(`take default must be a finite integer, got ${config.default}`)
      }
      if (config.default < 1) {
        throw new ShapeError(`take default must be at least 1, got ${config.default}`)
      }
      if (config.default > config.max) {
        throw new ShapeError('take default cannot exceed max')
      }
      return z.number().int().min(1).max(config.max).default(config.default)
    }
    return z.number().int().min(1).max(config.max).optional()
  }

  function buildCursorSchema(
    model: string,
    cursorConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    requireConfigTrue(cursorConfig, `cursor on model "${model}"`)

    const cursorFields = new Set(Object.keys(cursorConfig))
    const constraints = uniqueMap[model]
    if (constraints && constraints.length > 0) {
      const covered = constraints.some(constraint =>
        constraint.length === cursorFields.size &&
        constraint.every(field => cursorFields.has(field)),
      )
      if (!covered) {
        const constraintDesc = constraints.map(c => `(${c.join(', ')})`).join(' | ')
        throw new ShapeError(
          `cursor on model "${model}" must exactly match a unique constraint: ${constraintDesc}`,
        )
      }
    }

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    for (const fieldName of Object.keys(cursorConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in cursor`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in cursor`)
      if (fieldMeta.isList) throw new ShapeError(`List field "${fieldName}" cannot be used in cursor`)
      fieldSchemas[fieldName] = createBaseType(fieldMeta, enumMap, scalarBase)
    }
    return z.object(fieldSchemas).strict().optional()
  }

  function buildDistinctSchema(
    model: string,
    distinctConfig: string[],
  ): z.ZodTypeAny {
    if (distinctConfig.length === 0) {
      throw new ShapeError('distinct must contain at least one field')
    }

    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    for (const fieldName of distinctConfig) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in distinct`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in distinct`)
      if (fieldMeta.isList) throw new ShapeError(`List field "${fieldName}" cannot be used in distinct`)
    }

    const enumSchema = z.enum(distinctConfig as [string, ...string[]])
    return z.union([enumSchema, z.array(enumSchema).min(1)]).optional()
  }

  function buildBySchema(model: string, byConfig: string[]): z.ZodTypeAny {
    if (byConfig.length === 0) {
      throw new ShapeError('groupBy "by" must contain at least one field')
    }

    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    for (const fieldName of byConfig) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in by`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in by`)
      if (UNSUPPORTED_BY_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(`${fieldMeta.type} field "${fieldName}" cannot be used in by`)
      }
      if (fieldMeta.isList) throw new ShapeError(`List field "${fieldName}" cannot be used in by`)
    }
    const enumSchema = z.enum(byConfig as [string, ...string[]])
    return z.union([enumSchema, z.array(enumSchema).min(1)])
  }

  function buildHavingSchema(
    model: string,
    havingConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    requireConfigTrue(havingConfig, `having on model "${model}"`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    for (const fieldName of Object.keys(havingConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in having`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in having`)
      if (fieldMeta.isList) throw new ShapeError(`List field "${fieldName}" cannot be used in having`)

      const ops = getSupportedOperators(fieldMeta)
      if (ops.length === 0) {
        throw new ShapeError(`${fieldMeta.type} field "${fieldName}" cannot be used in having filters`)
      }

      const opSchemas: Record<string, z.ZodTypeAny> = {}
      const opKeys: string[] = []
      for (const op of ops) {
        opSchemas[op] = createOperatorSchema(fieldMeta, op, enumMap, scalarBase).optional()
        opKeys.push(op)
      }
      if (fieldMeta.type === 'String' && !fieldMeta.isList) {
        opSchemas['mode'] = z.enum(['default', 'insensitive']).optional()
      }
      fieldSchemas[fieldName] = z.object(opSchemas).strict()
        .refine(
          (v) => opKeys.some(k => (v as Record<string, unknown>)[k] !== undefined),
          { message: `At least one operator required for having field "${fieldName}"` },
        )
        .optional()
    }

    const havingFieldKeys = Object.keys(fieldSchemas)
    return z.object(fieldSchemas).strict()
      .refine(
        (v) => havingFieldKeys.some(k => (v as Record<string, unknown>)[k] !== undefined),
        { message: 'having must specify at least one field' },
      )
      .optional()
  }

  function buildAggregateFieldSchema(
    model: string,
    opName: string,
    fieldConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    requireConfigTrue(fieldConfig, `${opName} on model "${model}"`)

    const isNumericOnly = opName === '_avg' || opName === '_sum'
    const isComparableOnly = opName === '_min' || opName === '_max'

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    for (const fieldName of Object.keys(fieldConfig)) {
      if (fieldName === '_all' && opName === '_count') {
        fieldSchemas[fieldName] = z.literal(true).optional()
        continue
      }
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in ${opName}`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in ${opName}`)
      if (fieldMeta.isList) throw new ShapeError(`List field "${fieldName}" cannot be used in ${opName}`)
      if (isNumericOnly && !NUMERIC_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `Field "${fieldName}" (${fieldMeta.type}) cannot be used in ${opName}. Only numeric types (Int, Float, Decimal, BigInt) are supported.`,
        )
      }
      if (isComparableOnly && !COMPARABLE_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `Field "${fieldName}" (${fieldMeta.type}) cannot be used in ${opName}. Only comparable types (Int, Float, Decimal, BigInt, String, DateTime) are supported.`,
        )
      }
      fieldSchemas[fieldName] = z.literal(true).optional()
    }

    const aggFieldKeys = Object.keys(fieldSchemas)
    return z.object(fieldSchemas).strict()
      .refine(
        (v) => aggFieldKeys.some(k => (v as Record<string, unknown>)[k] !== undefined),
        { message: `${opName} must specify at least one field` },
      )
      .optional()
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

    requireConfigTrue(config, `${context} on model "${model}"`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    for (const fieldName of Object.keys(config)) {
      if (fieldName !== '_all') {
        const fieldMeta = modelFields[fieldName]
        if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in ${context}`)
        if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in ${context}`)
      }
      fieldSchemas[fieldName] = z.literal(true).optional()
    }

    const countFieldKeys = Object.keys(fieldSchemas)
    return z.object(fieldSchemas).strict()
      .refine(
        (v) => countFieldKeys.some(k => (v as Record<string, unknown>)[k] !== undefined),
        { message: `${context} must specify at least one field` },
      )
      .optional()
  }

  function buildCountSelectSchema(
    model: string,
    selectConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    requireConfigTrue(selectConfig, `count select on model "${model}"`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}
    for (const fieldName of Object.keys(selectConfig)) {
      if (fieldName === '_all') {
        fieldSchemas['_all'] = z.literal(true).optional()
        continue
      }
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in count select`)
      if (fieldMeta.isRelation) throw new ShapeError(`Relation field "${fieldName}" cannot be used in count select`)
      fieldSchemas[fieldName] = z.literal(true).optional()
    }

    const countSelectKeys = Object.keys(fieldSchemas)
    return z.object(fieldSchemas).strict()
      .refine(
        (v) => countSelectKeys.some(k => (v as Record<string, unknown>)[k] !== undefined),
        { message: 'count select must specify at least one field' },
      )
      .optional()
  }

  return {
    buildOrderBySchema,
    buildTakeSchema,
    buildCursorSchema,
    buildDistinctSchema,
    buildBySchema,
    buildHavingSchema,
    buildAggregateFieldSchema,
    buildCountFieldSchema,
    buildCountSelectSchema,
  }
}