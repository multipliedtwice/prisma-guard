import { z } from 'zod'
import type { FieldMeta, EnumMap } from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import type { ScalarBaseMap } from '../shared/scalar-base.js'

const SCALAR_OPERATORS: Record<string, Set<string>> = {
  String: new Set(['equals', 'not', 'contains', 'startsWith', 'endsWith', 'in', 'notIn']),
  Int: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  Float: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  Decimal: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  BigInt: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  Boolean: new Set(['equals', 'not']),
  DateTime: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  Bytes: new Set([]),
}

const SCALAR_LIST_OPERATORS = new Set(['has', 'hasEvery', 'hasSome', 'isEmpty', 'equals'])

const ENUM_OPERATORS = new Set(['equals', 'not', 'in', 'notIn'])

const NUMERIC_TYPES = new Set(['Int', 'Float', 'Decimal', 'BigInt'])
const COMPARABLE_TYPES = new Set(['Int', 'Float', 'Decimal', 'BigInt', 'String', 'DateTime'])

export { NUMERIC_TYPES, COMPARABLE_TYPES }

export function getSupportedOperators(fieldMeta: FieldMeta): string[] {
  if (fieldMeta.isList) return [...SCALAR_LIST_OPERATORS]
  if (fieldMeta.isEnum) return [...ENUM_OPERATORS]
  const ops = SCALAR_OPERATORS[fieldMeta.type]
  if (!ops) return []
  return [...ops]
}

export function createBaseType(fieldMeta: FieldMeta, enumMap: EnumMap, scalarBase: ScalarBaseMap): z.ZodTypeAny {
  let base: z.ZodTypeAny

  if (fieldMeta.isEnum) {
    const values = enumMap[fieldMeta.type]
    if (!values || values.length === 0) {
      throw new ShapeError(`Unknown enum: ${fieldMeta.type}`)
    }
    base = z.enum(values as unknown as [string, ...string[]])
  } else {
    const factory = scalarBase[fieldMeta.type]
    if (!factory) {
      throw new ShapeError(`Unknown scalar type: ${fieldMeta.type}`)
    }
    base = factory()
  }

  if (fieldMeta.isList) {
    base = z.array(base)
  }

  return base
}

export function createScalarListOperatorSchema(
  fieldMeta: FieldMeta,
  operator: string,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
): z.ZodTypeAny {
  if (!SCALAR_LIST_OPERATORS.has(operator)) {
    throw new ShapeError(`Operator "${operator}" not supported for scalar list fields`)
  }

  if (operator === 'isEmpty') {
    return z.boolean()
  }

  if (operator === 'equals') {
    const itemMeta: FieldMeta = { ...fieldMeta, isList: false }
    const itemBase = createBaseType(itemMeta, enumMap, scalarBase)
    return fieldMeta.isRequired ? z.array(itemBase) : z.union([z.array(itemBase), z.null()])
  }

  const itemMeta: FieldMeta = { ...fieldMeta, isList: false }
  const itemBase = createBaseType(itemMeta, enumMap, scalarBase)

  if (operator === 'has') {
    return !fieldMeta.isRequired ? z.union([itemBase, z.null()]) : itemBase
  }

  return z.array(itemBase)
}

export function createOperatorSchema(
  fieldMeta: FieldMeta,
  operator: string,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
): z.ZodTypeAny {
  if (fieldMeta.isList) {
    return createScalarListOperatorSchema(fieldMeta, operator, enumMap, scalarBase)
  }

  if (fieldMeta.isEnum) {
    const values = enumMap[fieldMeta.type]
    if (!values || values.length === 0) {
      throw new ShapeError(`Unknown enum: ${fieldMeta.type}`)
    }
    if (!ENUM_OPERATORS.has(operator)) {
      throw new ShapeError(`Operator "${operator}" not supported for enum fields`)
    }
    const enumSchema = z.enum(values as unknown as [string, ...string[]])
    if (operator === 'equals' || operator === 'not') {
      return !fieldMeta.isRequired ? z.union([enumSchema, z.null()]) : enumSchema
    }
    if (!fieldMeta.isRequired) {
      return z.array(z.union([enumSchema, z.null()]))
    }
    return z.array(enumSchema)
  }

  const supportedOps = SCALAR_OPERATORS[fieldMeta.type]
  if (!supportedOps) {
    throw new ShapeError(`Unknown scalar type for operator: ${fieldMeta.type}`)
  }
  if (supportedOps.size === 0) {
    throw new ShapeError(`Type "${fieldMeta.type}" does not support filter operators`)
  }
  if (!supportedOps.has(operator)) {
    throw new ShapeError(`Operator "${operator}" not supported for type "${fieldMeta.type}"`)
  }

  const factory = scalarBase[fieldMeta.type]
  if (!factory) {
    throw new ShapeError(`Unknown scalar type: ${fieldMeta.type}`)
  }

  const scalar = factory()

  if (operator === 'equals' || operator === 'not') {
    return !fieldMeta.isRequired ? z.union([scalar, z.null()]) : scalar
  }
  if (operator === 'in' || operator === 'notIn') {
    if (!fieldMeta.isRequired) {
      return z.array(z.union([scalar, z.null()]))
    }
    return z.array(scalar)
  }
  return scalar
}