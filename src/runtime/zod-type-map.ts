import { z } from 'zod'
import type { FieldMeta, EnumMap } from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'

const SCALAR_BASE: Record<string, () => z.ZodTypeAny> = {
  String: () => z.string(),
  Int: () => z.number().int(),
  Float: () => z.number(),
  Decimal: () => z.union([
    z.number(),
    z.string().regex(/^-?\d+(\.\d+)?$/),
    z.custom<unknown>(v => typeof v === 'object' && v !== null && typeof (v as any).toFixed === 'function'),
  ]),
  BigInt: () => z.bigint(),
  Boolean: () => z.boolean(),
  DateTime: () => z.coerce.date(),
  Json: () => z.unknown(),
  Bytes: () => z.union([
    z.string(),
    z.custom<unknown>(v => v instanceof Uint8Array),
  ]),
}

const SCALAR_OPERATORS: Record<string, Set<string>> = {
  String: new Set(['equals', 'not', 'contains', 'startsWith', 'endsWith', 'in', 'notIn']),
  Int: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  Float: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  Decimal: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  BigInt: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
  Boolean: new Set(['equals', 'not']),
  DateTime: new Set(['equals', 'not', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']),
}

const ENUM_OPERATORS = new Set(['equals', 'not', 'in', 'notIn'])

export function createBaseType(fieldMeta: FieldMeta, enumMap: EnumMap): z.ZodTypeAny {
  let base: z.ZodTypeAny

  if (fieldMeta.isEnum) {
    const values = enumMap[fieldMeta.type]
    if (!values || values.length === 0) {
      throw new ShapeError(`Unknown enum: ${fieldMeta.type}`)
    }
    base = z.enum(values as unknown as [string, ...string[]])
  } else {
    const factory = SCALAR_BASE[fieldMeta.type]
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

export function createOperatorSchema(
  fieldMeta: FieldMeta,
  operator: string,
  enumMap: EnumMap,
): z.ZodTypeAny {
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
  if (!supportedOps.has(operator)) {
    throw new ShapeError(`Operator "${operator}" not supported for type "${fieldMeta.type}"`)
  }

  const factory = SCALAR_BASE[fieldMeta.type]
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