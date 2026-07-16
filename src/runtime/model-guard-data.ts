import { z } from 'zod'
import type {
  TypeMap,
  ZodDefaults,
  DataFieldRefine,
  UniqueMap,
  EnumMap,
  FieldMeta,
} from '../shared/types.js'
import { ShapeError, wrapParseError } from '../shared/errors.js'
import { isForcedValue, isUnsupportedMarker } from '../shared/constants.js'
import { deepClone } from '../shared/deep-clone.js'
import {
  applyCreateUpdateNullability,
  type createSchemaBuilder,
} from './schema-builder.js'
import {
  schemaProducesValueForUndefined,
  isZodSchema,
  isPlainObject,
  coerceToArray,
} from '../shared/utils.js'
import { buildUniqueSelectorSchema } from './unique-selector-schema.js'
import type { ScalarBaseMap } from '../shared/scalar-base.js'
import {
  wrapRelationOp,
  assertAllowedKeys,
  requirePlainObjectConfig,
} from '../shared/zod-helpers.js'

export interface BuiltDataSchema {
  schema: z.ZodObject<any>
  forced: Record<string, unknown>
}

interface RelationOpContext {
  model: string
  fieldName: string
  relatedModelName: string
  isList: boolean
  config: unknown
  typeMap: TypeMap
  uniqueMap: UniqueMap
  enumMap: EnumMap
  scalarBase: ScalarBaseMap
  schemaBuilder: ReturnType<typeof createSchemaBuilder>
}

type RelationOpHandler = (ctx: RelationOpContext) => z.ZodTypeAny

const RELATION_OP_ALLOWED_KEYS: Record<string, Set<string>> = {
  connectOrCreate: new Set(['where', 'create']),
  createMany: new Set(['data', 'skipDuplicates']),
  'update.toMany': new Set(['where', 'data']),
  updateMany: new Set(['where', 'data']),
  'upsert.toOne': new Set(['where', 'create', 'update']),
  'upsert.toMany': new Set(['where', 'create', 'update']),
}

function validateRelationOpKeys(
  actual: Record<string, unknown>,
  opKey: string,
  model: string,
  field: string,
  opLabel: string,
): void {
  const allowed = RELATION_OP_ALLOWED_KEYS[opKey]
  if (!allowed) return

  assertAllowedKeys(
    actual,
    allowed,
    (key) =>
      `Unknown key "${key}" in ${opLabel} config on "${model}.${field}". Allowed: ${[...allowed].join(', ')}`,
  )
}

export function validateAllowedKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  method: string,
  kind: 'body' | 'shape',
): void {
  assertAllowedKeys(value, allowed, (key) => {
    if (kind === 'body') {
      return `Unexpected key "${key}" in ${method} body. Allowed keys: ${[...allowed].join(', ')}`
    }
    return `Shape key "${key}" not valid for ${method}. Allowed: ${[...allowed].join(', ')}`
  })
}

const RELATION_OPS_COVERING_FK = new Set([
  'connect',
  'connectOrCreate',
  'create',
])

function collectRelationCoveredFks(
  modelFields: Record<string, FieldMeta>,
  dataConfig: Record<string, true | unknown>,
): Set<string> {
  const covered = new Set<string>()

  for (const [fieldName, value] of Object.entries(dataConfig)) {
    const meta = modelFields[fieldName]
    if (!meta || !meta.isRelation) continue

    const fks = meta.relationFromFields
    if (!fks || fks.length === 0) continue

    if (!isPlainObject(value)) continue

    const covers = Object.keys(value).some((op) =>
      RELATION_OPS_COVERING_FK.has(op),
    )
    if (!covers) continue

    for (const fk of fks) covered.add(fk)
  }

  return covered
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
  const zodDefaultSet = zodDefaultFields
    ? new Set(zodDefaultFields)
    : undefined

  const relationCoveredFks = collectRelationCoveredFks(modelFields, dataConfig)

  for (const [fieldName, meta] of Object.entries(modelFields)) {
    if (meta.isRelation) continue
    if (meta.isUpdatedAt) continue
    if (meta.hasDefault) continue
    if (!meta.isRequired) continue
    if (fieldName in dataConfig) continue
    if (scopeFks.has(fieldName)) continue
    if (relationCoveredFks.has(fieldName)) continue
    if (zodDefaultSet && zodDefaultSet.has(fieldName)) continue

    throw new ShapeError(
      `Required field "${fieldName}" on model "${modelName}" is missing from create data shape, has no default, is not a scope FK, and is not covered by a relation write in the shape`,
    )
  }
}

function buildWhereFieldsSchema(
  model: string,
  config: Record<string, true>,
  typeMap: TypeMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
): z.ZodObject<any> {
  const modelFields = typeMap[model]
  if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

  const fieldSchemas: Record<string, z.ZodTypeAny> = {}
  const fieldKeys: string[] = []
  for (const [fieldName, value] of Object.entries(config)) {
    if (value !== true)
      throw new ShapeError(
        `Field "${fieldName}" in filter config must be true`,
      )
    const meta = modelFields[fieldName]
    if (!meta)
      throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)
    if (meta.isRelation)
      throw new ShapeError(
        `Relation field "${fieldName}" cannot be used in filter`,
      )
    fieldSchemas[fieldName] = schemaBuilder
      .buildFieldSchema(model, fieldName)
      .optional()
    fieldKeys.push(fieldName)
  }
  return z
    .object(fieldSchemas)
    .strict()
    .refine(
      (v) =>
        fieldKeys.some((k) => (v as Record<string, unknown>)[k] !== undefined),
      { message: `At least one field required in filter` },
    ) as unknown as z.ZodObject<any>
}

function buildNestedDataSchema(
  model: string,
  config: Record<string, true>,
  mode: 'create' | 'update',
  typeMap: TypeMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
): z.ZodObject<any> {
  const modelFields = typeMap[model]
  if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

  const fieldSchemas: Record<string, z.ZodTypeAny> = {}
  for (const [fieldName, value] of Object.entries(config)) {
    if (value !== true)
      throw new ShapeError(
        `Field "${fieldName}" in nested data config must be true`,
      )
    const meta = modelFields[fieldName]
    if (!meta)
      throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)
    if (meta.isRelation)
      throw new ShapeError(
        `Nested relation writes inside nested data are not supported ("${model}.${fieldName}")`,
      )
    if (meta.isUpdatedAt)
      throw new ShapeError(
        `updatedAt field "${fieldName}" cannot be used in nested data`,
      )
    if (meta.isUnsupported)
      throw new ShapeError(
        `Field "${fieldName}" on model "${model}" has an Unsupported type and cannot be used in nested data`,
      )

    const baseSchema = schemaBuilder.buildFieldSchema(model, fieldName)

    fieldSchemas[fieldName] = applyCreateUpdateNullability(meta, baseSchema, {
      mode,
      handlesUndefined: false,
    })
  }
  return z.object(fieldSchemas).strict()
}

function requireNestedObject(
  cfg: Record<string, unknown>,
  key: string,
  message: string,
): Record<string, unknown> {
  return requirePlainObjectConfig(cfg[key], message)
}

function buildRelatedUniqueSelector(
  ctx: RelationOpContext,
  cfg: Record<string, unknown>,
  context: string,
): z.ZodObject<any> {
  return buildUniqueSelectorSchema(
    ctx.model,
    ctx.fieldName,
    ctx.relatedModelName,
    cfg,
    ctx.typeMap,
    ctx.uniqueMap,
    ctx.enumMap,
    ctx.scalarBase,
    context,
  )
}

function buildRelatedNestedData(
  ctx: RelationOpContext,
  cfg: Record<string, true>,
  mode: 'create' | 'update',
): z.ZodObject<any> {
  return buildNestedDataSchema(
    ctx.relatedModelName,
    cfg,
    mode,
    ctx.typeMap,
    ctx.schemaBuilder,
  )
}

const handleConnect: RelationOpHandler = (ctx) => {
  const cfg = requirePlainObjectConfig(
    ctx.config,
    `connect config on "${ctx.model}.${ctx.fieldName}" must be an object of unique selectors`,
  )
  const schema = buildRelatedUniqueSelector(ctx, cfg, 'connect')
  return wrapRelationOp(ctx.isList, schema)
}

const handleConnectOrCreate: RelationOpHandler = (ctx) => {
  const cfg = requirePlainObjectConfig(
    ctx.config,
    `connectOrCreate config on "${ctx.model}.${ctx.fieldName}" must be an object with "where" and "create"`,
  )

  validateRelationOpKeys(cfg, 'connectOrCreate', ctx.model, ctx.fieldName, 'connectOrCreate')

  const where = requireNestedObject(
    cfg,
    'where',
    `connectOrCreate on "${ctx.model}.${ctx.fieldName}" requires "where" object`,
  )
  const create = requireNestedObject(
    cfg,
    'create',
    `connectOrCreate on "${ctx.model}.${ctx.fieldName}" requires "create" object`,
  )

  const whereSchema = buildRelatedUniqueSelector(ctx, where, 'connectOrCreate.where')
  const createSchema = buildRelatedNestedData(ctx, create as Record<string, true>, 'create')

  const cocSchema = z.object({ where: whereSchema, create: createSchema }).strict()
  return wrapRelationOp(ctx.isList, cocSchema)
}

const handleCreate: RelationOpHandler = (ctx) => {
  const cfg = requirePlainObjectConfig(
    ctx.config,
    `create config on "${ctx.model}.${ctx.fieldName}" must be an object of field names`,
  )
  const createSchema = buildRelatedNestedData(ctx, cfg as Record<string, true>, 'create')
  return wrapRelationOp(ctx.isList, createSchema)
}

const handleCreateMany: RelationOpHandler = (ctx) => {
  if (!ctx.isList) {
    throw new ShapeError(
      `createMany is only valid on to-many relations ("${ctx.model}.${ctx.fieldName}")`,
    )
  }

  const cfg = requirePlainObjectConfig(
    ctx.config,
    `createMany config on "${ctx.model}.${ctx.fieldName}" must be an object`,
  )

  validateRelationOpKeys(cfg, 'createMany', ctx.model, ctx.fieldName, 'createMany')

  const data = requireNestedObject(
    cfg,
    'data',
    `createMany on "${ctx.model}.${ctx.fieldName}" requires "data" object`,
  )

  const dataSchema = buildRelatedNestedData(ctx, data as Record<string, true>, 'create')
  const cmSchemaFields: Record<string, z.ZodTypeAny> = {
    data: z.preprocess(coerceToArray, z.array(dataSchema)),
  }
  if ('skipDuplicates' in cfg) {
    cmSchemaFields['skipDuplicates'] = z.boolean().optional()
  }
  return z.object(cmSchemaFields).strict().optional()
}

const handleDisconnect: RelationOpHandler = (ctx) => {
  if (ctx.config === true) {
    if (ctx.isList) {
      throw new ShapeError(
        `disconnect on to-many relation "${ctx.model}.${ctx.fieldName}" requires unique selector config, not true`,
      )
    }
    return z.literal(true).optional()
  }

  if (!isPlainObject(ctx.config)) {
    throw new ShapeError(
      `disconnect config on "${ctx.model}.${ctx.fieldName}" must be true (to-one) or an object of unique selectors`,
    )
  }

  const schema = buildRelatedUniqueSelector(ctx, ctx.config as Record<string, unknown>, 'disconnect')
  if (ctx.isList) return wrapRelationOp(true, schema)
  return z.union([z.literal(true), schema]).optional()
}

const handleDelete: RelationOpHandler = (ctx) => {
  if (ctx.config === true) {
    if (ctx.isList) {
      throw new ShapeError(
        `delete on to-many relation "${ctx.model}.${ctx.fieldName}" requires unique selector config, not true`,
      )
    }
    return z.literal(true).optional()
  }

  if (!isPlainObject(ctx.config)) {
    throw new ShapeError(
      `delete config on "${ctx.model}.${ctx.fieldName}" must be true (to-one) or an object of unique selectors`,
    )
  }

  const schema = buildRelatedUniqueSelector(ctx, ctx.config as Record<string, unknown>, 'delete')
  if (ctx.isList) return wrapRelationOp(true, schema)
  return z.union([z.literal(true), schema]).optional()
}

const handleSet: RelationOpHandler = (ctx) => {
  if (!ctx.isList) {
    throw new ShapeError(
      `set is only valid on to-many relations ("${ctx.model}.${ctx.fieldName}")`,
    )
  }
  const cfg = requirePlainObjectConfig(
    ctx.config,
    `set config on "${ctx.model}.${ctx.fieldName}" must be an object of unique selectors`,
  )
  const schema = buildRelatedUniqueSelector(ctx, cfg, 'set')
  return wrapRelationOp(true, schema)
}

const handleUpdate: RelationOpHandler = (ctx) => {
  const cfg = requirePlainObjectConfig(
    ctx.config,
    `update config on "${ctx.model}.${ctx.fieldName}" must be an object`,
  )

  if (ctx.isList) {
    validateRelationOpKeys(cfg, 'update.toMany', ctx.model, ctx.fieldName, 'update')

    const where = requireNestedObject(
      cfg,
      'where',
      `update on to-many "${ctx.model}.${ctx.fieldName}" requires "where" object`,
    )
    const data = requireNestedObject(
      cfg,
      'data',
      `update on to-many "${ctx.model}.${ctx.fieldName}" requires "data" object`,
    )

    const whereSchema = buildRelatedUniqueSelector(ctx, where, 'update.where')
    const dataSchema = buildRelatedNestedData(ctx, data as Record<string, true>, 'update')
    const updateSchema = z.object({ where: whereSchema, data: dataSchema }).strict()
    return wrapRelationOp(true, updateSchema)
  }

  const dataSchema = buildRelatedNestedData(ctx, cfg as Record<string, true>, 'update')
  return dataSchema.optional()
}

const handleUpsert: RelationOpHandler = (ctx) => {
  const cfg = requirePlainObjectConfig(
    ctx.config,
    `upsert config on "${ctx.model}.${ctx.fieldName}" must be an object`,
  )

  validateRelationOpKeys(
    cfg,
    ctx.isList ? 'upsert.toMany' : 'upsert.toOne',
    ctx.model,
    ctx.fieldName,
    'upsert',
  )

  const create = requireNestedObject(
    cfg,
    'create',
    `upsert on "${ctx.model}.${ctx.fieldName}" requires "create" object`,
  )
  const update = requireNestedObject(
    cfg,
    'update',
    `upsert on "${ctx.model}.${ctx.fieldName}" requires "update" object`,
  )

  const createSchema = buildRelatedNestedData(ctx, create as Record<string, true>, 'create')
  const updateSchema = buildRelatedNestedData(ctx, update as Record<string, true>, 'update')

  if (ctx.isList) {
    const where = requireNestedObject(
      cfg,
      'where',
      `upsert on to-many "${ctx.model}.${ctx.fieldName}" requires "where" object`,
    )
    const whereSchema = buildRelatedUniqueSelector(ctx, where, 'upsert.where')
    const upsertSchema = z
      .object({ where: whereSchema, create: createSchema, update: updateSchema })
      .strict()
    return wrapRelationOp(true, upsertSchema)
  }

  const hasWhereKey = 'where' in cfg

  if (hasWhereKey) {
    if (!isPlainObject(cfg.where)) {
      throw new ShapeError(
        `upsert on to-one "${ctx.model}.${ctx.fieldName}" has invalid "where": must be a plain object of unique selectors`,
      )
    }
    const whereSchema = buildRelatedUniqueSelector(ctx, cfg.where as Record<string, unknown>, 'upsert.where')
    const upsertSchema = z
      .object({ where: whereSchema, create: createSchema, update: updateSchema })
      .strict()
    return upsertSchema.optional()
  }

  const upsertSchema = z
    .object({ create: createSchema, update: updateSchema })
    .strict()
  return upsertSchema.optional()
}

const handleUpdateMany: RelationOpHandler = (ctx) => {
  if (!ctx.isList) {
    throw new ShapeError(
      `updateMany is only valid on to-many relations ("${ctx.model}.${ctx.fieldName}")`,
    )
  }
  const cfg = requirePlainObjectConfig(
    ctx.config,
    `updateMany config on "${ctx.model}.${ctx.fieldName}" must be an object`,
  )

  validateRelationOpKeys(cfg, 'updateMany', ctx.model, ctx.fieldName, 'updateMany')

  const where = requireNestedObject(
    cfg,
    'where',
    `updateMany on "${ctx.model}.${ctx.fieldName}" requires "where" object`,
  )
  if (Object.keys(where).length === 0) {
    throw new ShapeError(
      `updateMany "where" on "${ctx.model}.${ctx.fieldName}" must define at least one filter field`,
    )
  }

  const data = requireNestedObject(
    cfg,
    'data',
    `updateMany on "${ctx.model}.${ctx.fieldName}" requires "data" object`,
  )
  if (Object.keys(data).length === 0) {
    throw new ShapeError(
      `updateMany "data" on "${ctx.model}.${ctx.fieldName}" must define at least one field`,
    )
  }

  const whereSchema = buildWhereFieldsSchema(
    ctx.relatedModelName,
    where as Record<string, true>,
    ctx.typeMap,
    ctx.schemaBuilder,
  )
  const dataSchema = buildRelatedNestedData(ctx, data as Record<string, true>, 'update')
  const umSchema = z.object({ where: whereSchema, data: dataSchema }).strict()
  return wrapRelationOp(true, umSchema)
}

const handleDeleteMany: RelationOpHandler = (ctx) => {
  if (!ctx.isList) {
    throw new ShapeError(
      `deleteMany is only valid on to-many relations ("${ctx.model}.${ctx.fieldName}")`,
    )
  }
  const cfg = requirePlainObjectConfig(
    ctx.config,
    `deleteMany config on "${ctx.model}.${ctx.fieldName}" must be an object of allowed filter fields`,
  )
  if (Object.keys(cfg).length === 0) {
    throw new ShapeError(
      `deleteMany config on "${ctx.model}.${ctx.fieldName}" is empty. Unconstrained nested deletes are not allowed. Define at least one allowed filter field.`,
    )
  }

  const filterSchema = buildWhereFieldsSchema(
    ctx.relatedModelName,
    cfg as Record<string, true>,
    ctx.typeMap,
    ctx.schemaBuilder,
  )
  return wrapRelationOp(true, filterSchema)
}

const RELATION_OP_HANDLERS: Record<string, RelationOpHandler> = {
  connect: handleConnect,
  connectOrCreate: handleConnectOrCreate,
  create: handleCreate,
  createMany: handleCreateMany,
  disconnect: handleDisconnect,
  delete: handleDelete,
  set: handleSet,
  update: handleUpdate,
  upsert: handleUpsert,
  updateMany: handleUpdateMany,
  deleteMany: handleDeleteMany,
}

const KNOWN_RELATION_WRITE_OPS = new Set(Object.keys(RELATION_OP_HANDLERS))

function buildRelationWriteSchema(
  model: string,
  fieldName: string,
  relatedModelName: string,
  isList: boolean,
  config: Record<string, unknown>,
  typeMap: TypeMap,
  uniqueMap: UniqueMap,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
): z.ZodTypeAny {
  const relatedFields = typeMap[relatedModelName]
  if (!relatedFields)
    throw new ShapeError(
      `Unknown related model "${relatedModelName}" for field "${model}.${fieldName}"`,
    )

  assertAllowedKeys(
    config,
    KNOWN_RELATION_WRITE_OPS,
    (key) =>
      `Unknown relation write operation "${key}" on "${model}.${fieldName}". Allowed: ${[...KNOWN_RELATION_WRITE_OPS].join(', ')}`,
  )

  const definedEntries = Object.entries(config).filter(
    ([, opConfig]) => opConfig !== undefined,
  )

  if (definedEntries.length === 0) {
    throw new ShapeError(
      `Empty relation write config on "${model}.${fieldName}". Define at least one operation: ${[...KNOWN_RELATION_WRITE_OPS].join(', ')}`,
    )
  }

  const opSchemas: Record<string, z.ZodTypeAny> = {}

  for (const [op, opConfig] of definedEntries) {
    const handler = RELATION_OP_HANDLERS[op]
    opSchemas[op] = handler({
      model,
      fieldName,
      relatedModelName,
      isList,
      config: opConfig,
      typeMap,
      uniqueMap,
      enumMap,
      scalarBase,
      schemaBuilder,
    })
  }

  return z.object(opSchemas).strict()
}

export function buildDataSchema(
  model: string,
  dataConfig: Record<string, true | unknown>,
  mode: 'create' | 'update',
  typeMap: TypeMap,
  uniqueMap: UniqueMap,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
  zodDefaults: ZodDefaults,
  allowRelationWrites: boolean,
): BuiltDataSchema {
  const modelFields = typeMap[model]
  if (!modelFields) throw new ShapeError(`Unknown model: ${model}`)

  const zodDefaultFields = zodDefaults[model]
  const zodDefaultSet = zodDefaultFields
    ? new Set(zodDefaultFields)
    : undefined

  const schemaMap: Record<string, z.ZodTypeAny> = {}
  const forced: Record<string, unknown> = {}

  for (const [fieldName, value] of Object.entries(dataConfig)) {
    const fieldMeta = modelFields[fieldName]

    if (!fieldMeta) {
      if (isUnsupportedMarker(value)) {
        continue
      }
      throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`)
    }

    if (fieldMeta.isUnsupported) {
      if (isUnsupportedMarker(value)) {
        continue
      }
      if (value === true || typeof value === 'function') {
        throw new ShapeError(
          `Field "${fieldName}" on model "${model}" has an Unsupported type and cannot be client-controlled. Use unsupported() to acknowledge it or a forced server value.`,
        )
      }
      const actualValue = isForcedValue(value) ? value.value : value
      forced[fieldName] = deepClone(actualValue)
      continue
    }

    if (fieldMeta.isRelation) {
      if (!allowRelationWrites) {
        throw new ShapeError(
          `Field "${fieldName}" on model "${model}" is a relation. Relation writes are not supported for this method.`,
        )
      }
      if (!isPlainObject(value)) {
        throw new ShapeError(
          `Relation field "${fieldName}" on model "${model}" requires a relation write config object`,
        )
      }
      schemaMap[fieldName] = buildRelationWriteSchema(
        model,
        fieldName,
        fieldMeta.type,
        fieldMeta.isList,
        value as Record<string, unknown>,
        typeMap,
        uniqueMap,
        enumMap,
        scalarBase,
        schemaBuilder,
      ).optional()
      continue
    }

    if (fieldMeta.isUpdatedAt)
      throw new ShapeError(
        `updatedAt field "${fieldName}" cannot be used in data shape`,
      )

    if (typeof value === 'function') {
      const baseSchema: z.ZodTypeAny = schemaBuilder.buildBaseFieldSchema(
        model,
        fieldName,
      )
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
        throw new ShapeError(
          `Inline refine for "${model}.${fieldName}" must return a Zod schema`,
        )
      }

      const handlesUndefined = schemaProducesValueForUndefined(
        refined as z.ZodTypeAny,
      )

      schemaMap[fieldName] = applyCreateUpdateNullability(
        fieldMeta,
        refined as z.ZodTypeAny,
        { mode, handlesUndefined },
      )
    } else if (value === true) {
      const fieldSchema = schemaBuilder.buildFieldSchema(model, fieldName)
      const isZodDefaultField =
        zodDefaultSet !== undefined && zodDefaultSet.has(fieldName)

      schemaMap[fieldName] = applyCreateUpdateNullability(
        fieldMeta,
        fieldSchema,
        { mode, handlesUndefined: isZodDefaultField },
      )
    } else {
      const actualValue = isForcedValue(value) ? value.value : value
      let fieldSchema: z.ZodTypeAny = schemaBuilder.buildFieldSchema(
        model,
        fieldName,
      )
      if (!fieldMeta.isRequired) {
        fieldSchema = fieldSchema.nullable()
      }
      let parsed: unknown
      try {
        parsed = fieldSchema.parse(actualValue)
      } catch (err: any) {
        throw new ShapeError(
          `Invalid forced data value for "${model}.${fieldName}": ${err.message}`,
        )
      }
      forced[fieldName] = parsed
    }
  }

  if (mode === 'create' && zodDefaultFields) {
    for (const fieldName of zodDefaultFields) {
      if (fieldName in dataConfig) continue
      const fieldMeta = modelFields[fieldName]
      if (!fieldMeta) continue
      if (fieldMeta.isRelation) continue
      if (fieldMeta.isUpdatedAt) continue

      const fieldSchema = schemaBuilder.buildFieldSchema(model, fieldName)
      const result = fieldSchema.safeParse(undefined)
      if (result.success && result.data !== undefined) {
        forced[fieldName] = result.data
      } else {
        throw new ShapeError(
          `Field "${fieldName}" on model "${model}" has @zod default/catch but its schema does not produce a value for undefined input`,
        )
      }
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
  modelName?: string,
): Record<string, unknown> {
  if (bodyData === undefined || bodyData === null) {
    throw new ShapeError(`${method} requires "data" in request body`)
  }
  let validated: Record<string, unknown>
  try {
    validated = cached.schema.parse(bodyData) as Record<string, unknown>
  } catch (err) {
    const context = modelName
      ? `Invalid data for ${method} on model "${modelName}"`
      : `Invalid data for ${method}`
    wrapParseError(err, context)
  }
  return { ...validated!, ...deepClone(cached.forced) }
}

export function hasDataRefines(
  dataConfig: Record<string, true | unknown>,
): boolean {
  for (const value of Object.values(dataConfig)) {
    if (typeof value === 'function') return true
  }
  return false
}