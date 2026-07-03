import { z } from 'zod'
import type {
  TypeMap,
  UniqueMap,
  UniqueConstraint,
  EnumMap,
} from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import { type ScalarBaseMap } from '../shared/scalar-base.js'
import { isPlainObject } from '../shared/utils.js'
import { formatUniqueConstraints } from '../shared/unique-constraints.js'
import { buildDirectScalarSchema } from './direct-scalar-schema.js'

export function buildUniqueSelectorSchema(
  parentModel: string,
  parentField: string,
  relatedModel: string,
  config: Record<string, unknown>,
  typeMap: TypeMap,
  uniqueMap: UniqueMap,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
  context: string,
): z.ZodObject<any> {
  const modelFields = typeMap[relatedModel]
  if (!modelFields) {
    throw new ShapeError(
      `Unknown related model "${relatedModel}" for ${context} on "${parentModel}.${parentField}"`,
    )
  }

  const constraints = uniqueMap[relatedModel] ?? []

  if (constraints.length === 0) {
    throw new ShapeError(
      `${context} on "${parentModel}.${parentField}" requires related model "${relatedModel}" to have at least one unique constraint`,
    )
  }

  const configKeys = Object.keys(config)

  if (configKeys.length === 0) {
    throw new ShapeError(
      `${context} on "${parentModel}.${parentField}" must define at least one unique selector. Available: ${formatUniqueConstraints(constraints)}`,
    )
  }

  const fieldSchemas: Record<string, z.ZodTypeAny> = {}
  const fieldKeys: string[] = []

  for (const [key, value] of Object.entries(config)) {
    const compoundConstraint = constraints.find(
      (c) => c.selector === key && c.fields.length > 1,
    )

    if (compoundConstraint) {
      if (!isPlainObject(value)) {
        throw new ShapeError(
          `Compound unique selector "${key}" in ${context} on "${parentModel}.${parentField}" must be an object with fields: ${compoundConstraint.fields.join(', ')}`,
        )
      }

      const allowed = new Set(compoundConstraint.fields)
      const nestedKeys = Object.keys(value)

      for (const nestedKey of nestedKeys) {
        if (!allowed.has(nestedKey)) {
          throw new ShapeError(
            `Unknown field "${nestedKey}" in compound unique selector "${key}" on "${parentModel}.${parentField}". Allowed: ${compoundConstraint.fields.join(', ')}`,
          )
        }
      }

      for (const field of compoundConstraint.fields) {
        if (!(field in (value as Record<string, unknown>))) {
          throw new ShapeError(
            `Missing field "${field}" in compound unique selector "${key}" on "${parentModel}.${parentField}"`,
          )
        }

        const fieldValue = (value as Record<string, unknown>)[field]
        if (fieldValue !== true) {
          throw new ShapeError(
            `Field "${field}" in compound unique selector "${key}" on "${parentModel}.${parentField}" must be true`,
          )
        }
      }

      const nestedSchemas: Record<string, z.ZodTypeAny> = {}
      for (const field of compoundConstraint.fields) {
        const fieldMeta = modelFields[field]
        if (!fieldMeta) {
          throw new ShapeError(
            `Unknown field "${field}" on related model "${relatedModel}"`,
          )
        }
        if (fieldMeta.isRelation) {
          throw new ShapeError(
            `Relation field "${field}" cannot be used in compound unique selector`,
          )
        }
        nestedSchemas[field] = buildDirectScalarSchema(
          fieldMeta,
          enumMap,
          scalarBase,
        )
      }

      fieldSchemas[key] = z.object(nestedSchemas).strict().optional()
      fieldKeys.push(key)
      continue
    }

    const singleConstraint = constraints.find(
      (c) => c.fields.length === 1 && c.fields[0] === key && c.selector === key,
    )

    if (!singleConstraint) {
      const available = formatUniqueConstraints(constraints)
      throw new ShapeError(
        `Field "${key}" in ${context} on "${parentModel}.${parentField}" is not a unique selector on model "${relatedModel}". Available: ${available}`,
      )
    }

    if (value !== true) {
      throw new ShapeError(
        `Field "${key}" in ${context} on "${parentModel}.${parentField}" must be true`,
      )
    }

    const fieldMeta = modelFields[key]
    if (!fieldMeta) {
      throw new ShapeError(
        `Unknown field "${key}" on related model "${relatedModel}"`,
      )
    }
    if (fieldMeta.isRelation) {
      throw new ShapeError(
        `Relation field "${key}" cannot be used in unique selector`,
      )
    }

    fieldSchemas[key] = buildDirectScalarSchema(
      fieldMeta,
      enumMap,
      scalarBase,
    ).optional()
    fieldKeys.push(key)
  }

  return z
    .object(fieldSchemas)
    .strict()
    .refine(
      (v) =>
        fieldKeys.some((k) => (v as Record<string, unknown>)[k] !== undefined),
      {
        message: `${context} on "${parentModel}.${parentField}" requires at least one unique selector value`,
      },
    ) as unknown as z.ZodObject<any>
}