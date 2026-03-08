import { z } from 'zod'
import type { TypeMap, EnumMap, ZodChains, InputOpts, ModelOpts, InputSchema } from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import { createBaseType } from './zod-type-map.js'

const DEFAULT_MAX_CACHE = 500
const DEFAULT_MAX_DEPTH = 5

function lruGet(cache: Map<string, z.ZodTypeAny>, key: string): z.ZodTypeAny | undefined {
  const value = cache.get(key)
  if (value !== undefined) {
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

function lruSet(cache: Map<string, z.ZodTypeAny>, key: string, value: z.ZodTypeAny, maxSize: number): void {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  if (cache.size > maxSize) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.parse === 'function' && typeof v.optional === 'function'
}

export function createSchemaBuilder(
  typeMap: TypeMap,
  zodChains: ZodChains,
  enumMap: EnumMap,
) {
  const chainCache = new Map<string, z.ZodTypeAny>()

  function buildFieldSchema(model: string, field: string): z.ZodTypeAny {
    const cacheKey = `${model}.${field}`

    const cached = lruGet(chainCache, cacheKey)
    if (cached) return cached

    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldMeta = modelFields[field]
    if (!fieldMeta) throw new ShapeError(`Unknown field "${field}" on model "${model}"`)

    const base = createBaseType(fieldMeta, enumMap)

    let result = base
    const chainFn = zodChains[model]?.[field]
    if (chainFn) {
      try {
        result = chainFn(base)
      } catch (err: any) {
        throw new ShapeError(
          `Invalid @zod directive on ${model}.${field} (${fieldMeta.type}): ${err.message}`,
          { cause: err },
        )
      }
    }

    lruSet(chainCache, cacheKey, result, DEFAULT_MAX_CACHE)
    return result
  }

  function buildBaseFieldSchema(model: string, field: string): z.ZodTypeAny {
    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const fieldMeta = modelFields[field]
    if (!fieldMeta) throw new ShapeError(`Unknown field "${field}" on model "${model}"`)

    return createBaseType(fieldMeta, enumMap)
  }

  function buildInputSchema(model: string, opts: InputOpts): InputSchema {
    if (opts.pick && opts.omit) {
      throw new ShapeError('InputOpts cannot define both "pick" and "omit"')
    }

    const mode = opts.mode ?? 'create'
    const allowNull = opts.allowNull ?? false

    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    let fieldNames = Object.keys(modelFields).filter(name => {
      const meta = modelFields[name]
      return !meta.isRelation && !meta.isUpdatedAt
    })

    if (opts.pick) {
      for (const name of opts.pick) {
        if (!modelFields[name]) throw new ShapeError(`Unknown field "${name}" on model "${model}"`)
        if (modelFields[name].isRelation) throw new ShapeError(`Field "${name}" cannot be used in input schema (relation field)`)
        if (modelFields[name].isUpdatedAt) throw new ShapeError(`Field "${name}" cannot be used in input schema (updatedAt field)`)
      }
      fieldNames = fieldNames.filter(n => opts.pick!.includes(n))
    } else if (opts.omit) {
      for (const name of opts.omit) {
        if (!modelFields[name]) throw new ShapeError(`Unknown field "${name}" on model "${model}"`)
      }
      fieldNames = fieldNames.filter(n => !opts.omit!.includes(n))
    }

    const schemaMap: Record<string, z.ZodTypeAny> = {}

    for (const name of fieldNames) {
      const fieldMeta = modelFields[name]
      let fieldSchema: z.ZodTypeAny

      if (opts.refine?.[name]) {
        let refined: unknown
        try {
          refined = opts.refine[name](buildBaseFieldSchema(model, name))
        } catch (err: any) {
          throw new ShapeError(
            `Refine function for "${model}.${name}" threw: ${err.message}`,
            { cause: err },
          )
        }
        if (!isZodSchema(refined)) {
          throw new ShapeError(
            `Refine function for "${model}.${name}" must return a Zod schema`,
          )
        }
        fieldSchema = refined
      } else {
        fieldSchema = buildFieldSchema(model, name)
      }

      if (mode === 'create') {
        if (!fieldMeta.isRequired) {
          fieldSchema = allowNull
            ? fieldSchema.nullable().optional()
            : fieldSchema.optional()
        } else if (fieldMeta.hasDefault) {
          fieldSchema = fieldSchema.optional()
        }
      } else {
        if (!fieldMeta.isRequired && allowNull) {
          fieldSchema = fieldSchema.nullable().optional()
        } else {
          fieldSchema = fieldSchema.optional()
        }
      }

      schemaMap[name] = fieldSchema
    }

    let schema = z.object(schemaMap).strict()

    if (opts.partial) {
      schema = schema.partial() as any
    }

    return {
      schema,
      parse(data: unknown): Record<string, unknown> {
        return schema.parse(data) as Record<string, unknown>
      },
    }
  }

  function buildModelSchema(
    model: string,
    opts: ModelOpts,
    depth = 0,
    maxDepth?: number,
  ): z.ZodObject<any> {
    if (opts.pick && opts.omit) {
      throw new ShapeError('ModelOpts cannot define both "pick" and "omit"')
    }

    const effectiveMaxDepth = maxDepth ?? opts.maxDepth ?? DEFAULT_MAX_DEPTH
    if (depth > effectiveMaxDepth) {
      throw new ShapeError(`Maximum include depth (${effectiveMaxDepth}) exceeded`)
    }

    const modelFields = typeMap[model]
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

    const includeKeys = new Set(Object.keys(opts.include ?? {}))

    if (opts.pick) {
      for (const name of opts.pick) {
        if (!modelFields[name]) throw new ShapeError(`Unknown field "${name}" on model "${model}"`)
        if (modelFields[name].isRelation && !includeKeys.has(name)) {
          throw new ShapeError(`Field "${name}" is a relation on model "${model}". Use include: { ${name}: ... } instead of pick.`)
        }
      }
    }
    if (opts.omit) {
      for (const name of opts.omit) {
        if (!modelFields[name]) throw new ShapeError(`Unknown field "${name}" on model "${model}"`)
      }
    }

    let scalarNames = Object.keys(modelFields).filter(name => {
      const meta = modelFields[name]
      return !meta.isRelation
    })

    if (opts.pick) {
      scalarNames = scalarNames.filter(n => opts.pick!.includes(n))
    } else if (opts.omit) {
      scalarNames = scalarNames.filter(n => !opts.omit!.includes(n))
    }

    const schemaMap: Record<string, z.ZodTypeAny> = {}

    for (const name of scalarNames) {
      const fieldMeta = modelFields[name]
      let fieldSchema = createBaseType(fieldMeta, enumMap)
      if (!fieldMeta.isRequired) {
        fieldSchema = fieldSchema.nullable()
      }
      schemaMap[name] = fieldSchema
    }

    for (const [relName, relOpts] of Object.entries(opts.include ?? {})) {
      const fieldMeta = modelFields[relName]
      if (!fieldMeta) throw new ShapeError(`Unknown field "${relName}" on model "${model}"`)
      if (!fieldMeta.isRelation) throw new ShapeError(`Field "${relName}" is not a relation on model "${model}"`)

      const relatedModel = fieldMeta.type
      if (!typeMap[relatedModel]) {
        throw new ShapeError(`Related model "${relatedModel}" not found in type map`)
      }
      let relSchema: z.ZodTypeAny = buildModelSchema(
        relatedModel,
        relOpts,
        depth + 1,
        effectiveMaxDepth,
      )
      if (fieldMeta.isList) {
        relSchema = z.array(relSchema)
      } else if (!fieldMeta.isRequired) {
        relSchema = relSchema.nullable()
      }
      schemaMap[relName] = relSchema
    }

    if (opts._count) {
      const relationNames = Object.keys(modelFields).filter(n => modelFields[n].isRelation)

      if (opts._count === true) {
        const countFields: Record<string, z.ZodTypeAny> = {}
        for (const relName of relationNames) {
          countFields[relName] = z.number().int().min(0)
        }
        schemaMap['_count'] = z.object(countFields)
      } else {
        const countFields: Record<string, z.ZodTypeAny> = {}
        for (const relName of Object.keys(opts._count)) {
          if (!modelFields[relName]) throw new ShapeError(`Unknown field "${relName}" on model "${model}" in _count`)
          if (!modelFields[relName].isRelation) throw new ShapeError(`Field "${relName}" is not a relation on model "${model}" in _count`)
          countFields[relName] = z.number().int().min(0)
        }
        schemaMap['_count'] = z.object(countFields)
      }
    }

    let schema = z.object(schemaMap)
    if (opts.strict) {
      schema = schema.strict() as any
    }
    return schema
  }

  return { buildFieldSchema, buildBaseFieldSchema, buildInputSchema, buildModelSchema }
}