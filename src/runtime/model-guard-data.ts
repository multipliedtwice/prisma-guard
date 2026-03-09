import { z } from 'zod'
import type { TypeMap, ScopeMap, ZodDefaults, DataFieldRefine } from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import type { createSchemaBuilder } from './schema-builder.js'

export interface BuiltDataSchema {
  schema: z.ZodObject<any>
  forced: Record<string, unknown>
}

export const ALLOWED_BODY_KEYS_CREATE = new Set(['data'])
export const ALLOWED_BODY_KEYS_CREATE_PROJECTION = new Set(['data', 'select', 'include'])
export const ALLOWED_BODY_KEYS_CREATE_MANY = new Set(['data', 'skipDuplicates'])
export const ALLOWED_BODY_KEYS_CREATE_MANY_PROJECTION = new Set(['data', 'select', 'include', 'skipDuplicates'])
export const ALLOWED_BODY_KEYS_UPDATE = new Set(['data', 'where'])
export const ALLOWED_BODY_KEYS_UPDATE_PROJECTION = new Set(['data', 'where', 'select', 'include'])
export const ALLOWED_BODY_KEYS_DELETE = new Set(['where'])
export const ALLOWED_BODY_KEYS_DELETE_PROJECTION = new Set(['where', 'select', 'include'])

export const VALID_SHAPE_KEYS_CREATE = new Set(['data'])
export const VALID_SHAPE_KEYS_CREATE_PROJECTION = new Set(['data', 'select', 'include'])
export const VALID_SHAPE_KEYS_UPDATE = new Set(['data', 'where'])
export const VALID_SHAPE_KEYS_UPDATE_PROJECTION = new Set(['data', 'where', 'select', 'include'])
export const VALID_SHAPE_KEYS_DELETE = new Set(['where'])
export const VALID_SHAPE_KEYS_DELETE_PROJECTION = new Set(['where', 'select', 'include'])

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.parse === 'function' && typeof v.optional === 'function'
}

export function validateMutationBodyKeys(
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

export function validateMutationShapeKeys(
  shape: Record<string, unknown>,
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

export function validateCreateCompleteness(
  modelName: string,
  dataConfig: Record<string, true | unknown>,
  typeMap: TypeMap,
  scopeFks: Set<string>,
  zodDefaults: ZodDefaults,
): void {
  const modelFields = typeMap[modelName]
  if (!modelFields) return

  const zodDefaultFields = zodDefaults[modelName]
  const zodDefaultSet = zodDefaultFields ? new Set(zodDefaultFields) : undefined

  for (const [fieldName, meta] of Object.entries(modelFields)) {
    if (meta.isRelation) continue
    if (meta.isUpdatedAt) continue
    if (meta.hasDefault) continue
    if (!meta.isRequired) continue
    if (fieldName in dataConfig) continue
    if (scopeFks.has(fieldName)) continue
    if (zodDefaultSet && zodDefaultSet.has(fieldName)) continue

    throw new ShapeError(
      `Required field "${fieldName}" on model "${modelName}" is missing from create data shape, has no default, and is not a scope FK`,
    )
  }
}

export function buildDataSchema(
  model: string,
  dataConfig: Record<string, true | unknown>,
  mode: 'create' | 'update',
  typeMap: TypeMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
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
      let refined: unknown
      try {
        refined = (value as DataFieldRefine)(baseSchema)
      } catch (err: any) {
        throw new ShapeError(
          `Invalid inline refine for "${model}.${fieldName}": ${err.message}`,
          { cause: err },
        )
      }

      if (!isZodSchema(refined)) {
        throw new ShapeError(`Inline refine for "${model}.${fieldName}" must return a Zod schema`)
      }

      let fieldSchema: z.ZodTypeAny = refined

      if (mode === 'create') {
        if (!fieldMeta.isRequired) {
          fieldSchema = fieldSchema.nullable().optional()
        } else if (fieldMeta.hasDefault) {
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
        if (!fieldMeta.isRequired) {
          fieldSchema = fieldSchema.nullable().optional()
        } else if (fieldMeta.hasDefault) {
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

export function validateAndMergeData(
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

export function hasDataRefines(dataConfig: Record<string, true | unknown>): boolean {
  for (const value of Object.values(dataConfig)) {
    if (typeof value === 'function') return true
  }
  return false
}