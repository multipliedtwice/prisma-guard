import { z } from 'zod'
import type {
  TypeMap,
  EnumMap,
  UniqueMap,
  OrderByFieldConfig,
  UniqueConstraint,
} from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import {
  getSupportedOperators,
  createOperatorSchema,
  NUMERIC_TYPES,
  COMPARABLE_TYPES,
} from './zod-type-map.js'
import { isPlainObject } from '../shared/utils.js'
import { type ScalarBaseMap } from '../shared/scalar-base.js'
import {
  strictObjectRequiringOne,
  singleOrArraySchema,
  buildLiteralTrueSchema,
  requireConfigTrue,
} from '../shared/zod-helpers.js'
import { formatUniqueConstraints } from '../shared/unique-constraints.js'
import { buildDirectScalarSchema } from './direct-scalar-schema.js'

const UNSUPPORTED_BY_TYPES = new Set(['Json', 'Bytes'])

export function createArgsBuilder(
  typeMap: TypeMap,
  enumMap: EnumMap,
  uniqueMap: UniqueMap,
  scalarBase: ScalarBaseMap,
) {
  const sortEnum = z.enum(['asc', 'desc'])
  const nullsEnum = z.enum(['first', 'last'])
  const sortWithNulls = z
    .object({ sort: sortEnum, nulls: nullsEnum.optional() })
    .strict()
  const scalarOrderSchema = z.union([sortEnum, sortWithNulls])

  function validateScalarOrderByField(
    fieldName: string,
    model: string,
    modelFields: Record<
      string,
      { type: string; isList: boolean; isRelation: boolean }
    >,
  ): void {
    const fieldMeta = modelFields[fieldName]
    if (!fieldMeta)
      throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)
    if (fieldMeta.isRelation)
      throw new ShapeError(
        `Relation field "${fieldName}" in orderBy requires a nested config object, not true`,
      )
    if (fieldMeta.type === 'Json')
      throw new ShapeError(
        `Json field "${fieldName}" cannot be used in orderBy`,
      )
    if (fieldMeta.isList)
      throw new ShapeError(
        `List field "${fieldName}" cannot be used in orderBy`,
      )
  }

  function buildOrderBySchema(
    model: string,
    orderByConfig: Record<string, OrderByFieldConfig>,
  ): z.ZodTypeAny {
    if (!isPlainObject(orderByConfig)) {
      throw new ShapeError(
        `orderBy shape config on model "${model}" must be an object of fields`,
      )
    }

    if (Object.keys(orderByConfig).length === 0) {
      throw new ShapeError(
        `Empty orderBy config on model "${model}". Define at least one field.`,
      )
    }

    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}

    for (const [fieldName, config] of Object.entries(orderByConfig)) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}"`,
        )

      if (config === true) {
        validateScalarOrderByField(fieldName, model, modelFields)
        fieldSchemas[fieldName] = scalarOrderSchema.optional()
        continue
      }

      if (!isPlainObject(config)) {
        throw new ShapeError(
          `orderBy config for "${fieldName}" on model "${model}" must be true or a relation config object`,
        )
      }

      if (!fieldMeta.isRelation) {
        throw new ShapeError(
          `orderBy config for scalar field "${model}.${fieldName}" must be true. Operator objects are not valid in orderBy.`,
        )
      }

      if (fieldMeta.isList) {
        const configKeys = Object.keys(config)

        if (!configKeys.includes('_count')) {
          throw new ShapeError(
            `To-many relation orderBy "${fieldName}" only supports _count`,
          )
        }

        const extraKeys = configKeys.filter((k) => k !== '_count')
        if (extraKeys.length > 0) {
          throw new ShapeError(
            `To-many relation orderBy "${fieldName}" only supports _count. Unexpected keys: ${extraKeys.join(', ')}`,
          )
        }

        if (config._count !== true) {
          throw new ShapeError(
            `orderBy relation aggregate "${fieldName}._count" must be true`,
          )
        }

        fieldSchemas[fieldName] = z
          .object({
            _count: sortEnum.optional(),
          })
          .strict()
          .optional()
        continue
      }

      const nested = buildOrderBySchema(
        fieldMeta.type,
        config as Record<string, OrderByFieldConfig>,
      )
      fieldSchemas[fieldName] = nested
    }

    const singleSchema = strictObjectRequiringOne(
      fieldSchemas,
      'orderBy must specify at least one field',
    )

    return singleOrArraySchema(singleSchema).optional()
  }

  function buildTakeSchema(
    config: number | { max: number; default?: number },
  ): z.ZodTypeAny {
    if (typeof config === 'number') {
      if (!Number.isFinite(config) || !Number.isInteger(config)) {
        throw new ShapeError(`take must be a finite integer, got ${config}`)
      }

      if (config <= 0) {
        throw new ShapeError('take must be a positive integer')
      }

      return z.number().int().min(1).max(config).default(config)
    }

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new ShapeError('take config must be a number or { max, default? }')
    }

    if (!Number.isFinite(config.max) || !Number.isInteger(config.max)) {
      throw new ShapeError(
        `take.max must be a finite integer, got ${config.max}`,
      )
    }

    if (config.max <= 0) {
      throw new ShapeError('take.max must be a positive integer')
    }

    if (config.default !== undefined) {
      if (
        !Number.isFinite(config.default) ||
        !Number.isInteger(config.default)
      ) {
        throw new ShapeError(
          `take.default must be a finite integer, got ${config.default}`,
        )
      }

      if (config.default <= 0) {
        throw new ShapeError('take.default must be a positive integer')
      }

      if (config.default > config.max) {
        throw new ShapeError('take.default cannot exceed take.max')
      }

      return z.number().int().min(1).max(config.max).default(config.default)
    }

    return z.number().int().min(1).max(config.max).optional()
  }

  function buildCursorFieldSchema(
    model: string,
    fieldName: string,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldMeta = modelFields[fieldName]
    if (!fieldMeta) {
      throw new ShapeError(
        `Unknown field "${fieldName}" on model "${model}" in cursor`,
      )
    }

    if (fieldMeta.isRelation) {
      throw new ShapeError(
        `Relation field "${fieldName}" cannot be used in cursor`,
      )
    }

    if (fieldMeta.isList) {
      throw new ShapeError(
        `List field "${fieldName}" cannot be used in cursor`,
      )
    }

    return buildDirectScalarSchema(fieldMeta, enumMap, scalarBase)
  }

  function cursorConfigMatchesConstraint(
    cursorConfig: Record<string, unknown>,
    constraint: UniqueConstraint,
  ): boolean {
    if (!(constraint.selector in cursorConfig)) return false

    const value = cursorConfig[constraint.selector]

    if (constraint.fields.length === 1) {
      return value === true
    }

    if (!isPlainObject(value)) return false

    const keys = Object.keys(value)

    if (keys.length !== constraint.fields.length) return false

    return constraint.fields.every((field) => value[field] === true)
  }

  function buildCursorSchema(
    model: string,
    cursorConfig: Record<string, unknown>,
  ): z.ZodTypeAny {
    const constraints = uniqueMap[model] ?? []

    if (constraints.length === 0) {
      throw new ShapeError(
        `cursor on model "${model}" requires at least one unique constraint`,
      )
    }

    const matching = constraints.filter((constraint) =>
      cursorConfigMatchesConstraint(cursorConfig, constraint),
    )

    if (matching.length === 0) {
      throw new ShapeError(
        `cursor on model "${model}" must match a unique selector: ${formatUniqueConstraints(constraints)}`,
      )
    }

    const coveredKeys = new Set(matching.map((c) => c.selector))

    for (const key of Object.keys(cursorConfig)) {
      if (!coveredKeys.has(key)) {
        throw new ShapeError(
          `cursor field "${key}" on model "${model}" does not match any unique selector. Unique selectors: ${formatUniqueConstraints(constraints)}`,
        )
      }
    }

    const fieldSchemas: Record<string, z.ZodTypeAny> = {}

    for (const constraint of matching) {
      if (constraint.fields.length === 1) {
        fieldSchemas[constraint.selector] = buildCursorFieldSchema(
          model,
          constraint.fields[0],
        ).optional()
      } else {
        const nestedSchemas: Record<string, z.ZodTypeAny> = {}

        for (const field of constraint.fields) {
          nestedSchemas[field] = buildCursorFieldSchema(model, field)
        }

        fieldSchemas[constraint.selector] = z
          .object(nestedSchemas)
          .strict()
          .optional()
      }
    }

    const selectorKeys = matching.map((c) => c.selector)

    return strictObjectRequiringOne(
      fieldSchemas,
      `cursor must specify one of: ${selectorKeys.join(', ')}`,
    ).optional()
  }

  function buildDistinctSchema(
    model: string,
    distinctConfig: string[],
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    if (!Array.isArray(distinctConfig) || distinctConfig.length === 0) {
      throw new ShapeError(
        `distinct on model "${model}" must be a non-empty array of scalar fields`,
      )
    }

    const allowedFields = new Set<string>()

    for (const fieldName of distinctConfig) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in distinct`,
        )
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in distinct`,
        )
      allowedFields.add(fieldName)
    }

    const fieldEnum = z.enum([...allowedFields] as [string, ...string[]])

    return z
      .union([fieldEnum, z.array(fieldEnum).min(1)])
      .optional()
  }

  function buildBySchema(model: string, byConfig: string[]): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    if (!Array.isArray(byConfig) || byConfig.length === 0) {
      throw new ShapeError(
        `groupBy "by" on model "${model}" must be a non-empty array`,
      )
    }

    const allowedFields = new Set<string>()

    for (const fieldName of byConfig) {
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in groupBy by`,
        )
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in groupBy by`,
        )
      if (fieldMeta.isList)
        throw new ShapeError(
          `List field "${fieldName}" cannot be used in groupBy by`,
        )
      if (UNSUPPORTED_BY_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `${fieldMeta.type} field "${fieldName}" cannot be used in groupBy by`,
        )
      }
      allowedFields.add(fieldName)
    }

    return z.array(z.enum([...allowedFields] as [string, ...string[]])).min(1)
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
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in having`,
        )
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in having`,
        )
      if (fieldMeta.isList)
        throw new ShapeError(
          `List field "${fieldName}" cannot be used in having`,
        )
      if (UNSUPPORTED_BY_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `${fieldMeta.type} field "${fieldName}" cannot be used in having`,
        )
      }

      const allowedOps = getSupportedOperators(
        fieldMeta.type,
        fieldMeta.isList,
      )
      const opSchemas: Record<string, z.ZodTypeAny> = {}

      for (const op of allowedOps) {
        opSchemas[op] = createOperatorSchema(
          fieldMeta,
          op,
          enumMap,
          scalarBase,
        ).optional()
      }

      if (fieldMeta.type === 'String') {
        opSchemas.mode = z.enum(['default', 'insensitive']).optional()
      }

      const opKeys = Object.keys(opSchemas).filter((key) => key !== 'mode')
      const opShape: Record<string, z.ZodTypeAny> = { ...opSchemas }
      const opObjSchema = z
        .object(opShape)
        .strict()
        .refine(
          (v) =>
            opKeys.some((k) => (v as Record<string, unknown>)[k] !== undefined),
          {
            message: `having field "${fieldName}" must specify at least one operator`,
          },
        )

      fieldSchemas[fieldName] = opObjSchema.optional()
    }

    return strictObjectRequiringOne(
      fieldSchemas,
      'having must specify at least one field',
    ).optional()
  }

  function buildAggregateFieldSchema(
    model: string,
    op: '_avg' | '_sum' | '_min' | '_max',
    config: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    requireConfigTrue(config, `${op} on model "${model}"`)

    const allowedTypes =
      op === '_avg' || op === '_sum' ? NUMERIC_TYPES : COMPARABLE_TYPES

    return buildLiteralTrueSchema(
      Object.keys(config),
      `${op} must specify at least one field`,
      (fieldName) => {
        const fieldMeta = modelFields[fieldName]
        if (!fieldMeta)
          throw new ShapeError(
            `Unknown field "${fieldName}" on model "${model}" in ${op}`,
          )
        if (fieldMeta.isRelation)
          throw new ShapeError(
            `Relation field "${fieldName}" cannot be used in ${op}`,
          )
        if (fieldMeta.isList)
          throw new ShapeError(
            `List field "${fieldName}" cannot be used in ${op}`,
          )
        if (!allowedTypes.has(fieldMeta.type)) {
          throw new ShapeError(
            `Field "${fieldName}" of type "${fieldMeta.type}" cannot be used in ${op}`,
          )
        }
      },
    )
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

    return buildLiteralTrueSchema(
      Object.keys(config),
      `${context} must specify at least one field`,
      (fieldName) => {
        if (fieldName === '_all') return
        const fieldMeta = modelFields[fieldName]
        if (!fieldMeta)
          throw new ShapeError(
            `Unknown field "${fieldName}" on model "${model}" in ${context}`,
          )
        if (fieldMeta.isRelation)
          throw new ShapeError(
            `Relation field "${fieldName}" cannot be used in ${context}`,
          )
      },
    )
  }

  function buildCountSelectSchema(
    model: string,
    selectConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    requireConfigTrue(selectConfig, `count select on model "${model}"`)

    return buildLiteralTrueSchema(
      Object.keys(selectConfig),
      'count select must specify at least one field',
      (fieldName) => {
        if (fieldName === '_all') return
        const fieldMeta = modelFields[fieldName]
        if (!fieldMeta)
          throw new ShapeError(
            `Unknown field "${fieldName}" on model "${model}" in count select`,
          )
        if (fieldMeta.isRelation)
          throw new ShapeError(
            `Relation field "${fieldName}" cannot be used in count select`,
          )
      },
    )
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