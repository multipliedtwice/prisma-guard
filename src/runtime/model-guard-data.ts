import { z } from "zod";
import type {
  TypeMap,
  ScopeMap,
  ZodDefaults,
  DataFieldRefine,
} from "../shared/types.js";
import { ShapeError } from "../shared/errors.js";
import { isForcedValue } from "../shared/constants.js";
import { deepClone } from "../shared/deep-clone.js";
import type { createSchemaBuilder } from "./schema-builder.js";
import {
  schemaProducesValueForUndefined,
  isZodSchema,
  isPlainObject,
  coerceToArray,
} from "../shared/utils.js";

export interface BuiltDataSchema {
  schema: z.ZodObject<any>;
  forced: Record<string, unknown>;
}

export const ALLOWED_BODY_KEYS_CREATE = new Set(["data"]);
export const ALLOWED_BODY_KEYS_CREATE_PROJECTION = new Set([
  "data",
  "select",
  "include",
]);
export const ALLOWED_BODY_KEYS_CREATE_MANY = new Set([
  "data",
  "skipDuplicates",
]);
export const ALLOWED_BODY_KEYS_CREATE_MANY_PROJECTION = new Set([
  "data",
  "select",
  "include",
  "skipDuplicates",
]);
export const ALLOWED_BODY_KEYS_UPDATE = new Set(["data", "where"]);
export const ALLOWED_BODY_KEYS_UPDATE_PROJECTION = new Set([
  "data",
  "where",
  "select",
  "include",
]);
export const ALLOWED_BODY_KEYS_DELETE = new Set(["where"]);
export const ALLOWED_BODY_KEYS_DELETE_PROJECTION = new Set([
  "where",
  "select",
  "include",
]);
export const ALLOWED_BODY_KEYS_UPSERT = new Set([
  "where",
  "create",
  "update",
  "select",
  "include",
]);

export const VALID_SHAPE_KEYS_CREATE = new Set(["data"]);
export const VALID_SHAPE_KEYS_CREATE_PROJECTION = new Set([
  "data",
  "select",
  "include",
]);
export const VALID_SHAPE_KEYS_UPDATE = new Set(["data", "where"]);
export const VALID_SHAPE_KEYS_UPDATE_PROJECTION = new Set([
  "data",
  "where",
  "select",
  "include",
]);
export const VALID_SHAPE_KEYS_DELETE = new Set(["where"]);
export const VALID_SHAPE_KEYS_DELETE_PROJECTION = new Set([
  "where",
  "select",
  "include",
]);
export const VALID_SHAPE_KEYS_UPSERT = new Set([
  "where",
  "create",
  "update",
  "select",
  "include",
]);

const KNOWN_RELATION_WRITE_OPS = new Set([
  "connect",
  "connectOrCreate",
  "create",
  "createMany",
  "disconnect",
  "delete",
  "set",
  "update",
  "updateMany",
  "upsert",
  "deleteMany",
]);

export function validateMutationBodyKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
  method: string,
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new ShapeError(
        `Unexpected key "${key}" in ${method} body. Allowed keys: ${[...allowed].join(", ")}`,
      );
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
        `Shape key "${key}" not valid for ${method}. Allowed: ${[...allowed].join(", ")}`,
      );
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
  const modelFields = typeMap[modelName];
  if (!modelFields) return;

  const zodDefaultFields = zodDefaults[modelName];
  const zodDefaultSet = zodDefaultFields
    ? new Set(zodDefaultFields)
    : undefined;

  for (const [fieldName, meta] of Object.entries(modelFields)) {
    if (meta.isRelation) continue;
    if (meta.isUpdatedAt) continue;
    if (meta.hasDefault) continue;
    if (!meta.isRequired) continue;
    if (fieldName in dataConfig) continue;
    if (scopeFks.has(fieldName)) continue;
    if (zodDefaultSet && zodDefaultSet.has(fieldName)) continue;

    throw new ShapeError(
      `Required field "${fieldName}" on model "${modelName}" is missing from create data shape, has no default, and is not a scope FK`,
    );
  }
}

function buildWhereFieldsSchema(
  model: string,
  config: Record<string, true>,
  typeMap: TypeMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
): z.ZodObject<any> {
  const modelFields = typeMap[model];
  if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

  const fieldSchemas: Record<string, z.ZodTypeAny> = {};
  const fieldKeys: string[] = [];
  for (const [fieldName, value] of Object.entries(config)) {
    if (value !== true)
      throw new ShapeError(
        `Field "${fieldName}" in connect/where config must be true`,
      );
    const meta = modelFields[fieldName];
    if (!meta)
      throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`);
    if (meta.isRelation)
      throw new ShapeError(
        `Relation field "${fieldName}" cannot be used in connect/where`,
      );
    fieldSchemas[fieldName] = schemaBuilder
      .buildFieldSchema(model, fieldName)
      .optional();
    fieldKeys.push(fieldName);
  }
  return z
    .object(fieldSchemas)
    .strict()
    .refine(
      (v) =>
        fieldKeys.some((k) => (v as Record<string, unknown>)[k] !== undefined),
      { message: `At least one field required in connect/where` },
    ) as unknown as z.ZodObject<any>;
}

function buildNestedDataSchema(
  model: string,
  config: Record<string, true>,
  typeMap: TypeMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
): z.ZodObject<any> {
  const modelFields = typeMap[model];
  if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

  const fieldSchemas: Record<string, z.ZodTypeAny> = {};
  for (const [fieldName, value] of Object.entries(config)) {
    if (value !== true)
      throw new ShapeError(
        `Field "${fieldName}" in nested data config must be true`,
      );
    const meta = modelFields[fieldName];
    if (!meta)
      throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`);
    if (meta.isRelation)
      throw new ShapeError(
        `Nested relation writes inside nested data are not supported ("${model}.${fieldName}")`,
      );
    if (meta.isUpdatedAt)
      throw new ShapeError(
        `updatedAt field "${fieldName}" cannot be used in nested data`,
      );

    let fieldSchema = schemaBuilder.buildFieldSchema(model, fieldName);
    if (!meta.isRequired) {
      fieldSchema = fieldSchema.nullable().optional();
    } else if (meta.hasDefault) {
      fieldSchema = fieldSchema.optional();
    }
    fieldSchemas[fieldName] = fieldSchema;
  }
  return z.object(fieldSchemas).strict();
}

function buildRelationWriteSchema(
  model: string,
  fieldName: string,
  relatedModelName: string,
  isList: boolean,
  config: Record<string, unknown>,
  typeMap: TypeMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
): z.ZodTypeAny {
  const relatedFields = typeMap[relatedModelName];
  if (!relatedFields)
    throw new ShapeError(
      `Unknown related model "${relatedModelName}" for field "${model}.${fieldName}"`,
    );

  for (const key of Object.keys(config)) {
    if (!KNOWN_RELATION_WRITE_OPS.has(key)) {
      throw new ShapeError(
        `Unknown relation write operation "${key}" on "${model}.${fieldName}". Allowed: ${[...KNOWN_RELATION_WRITE_OPS].join(", ")}`,
      );
    }
  }

  const opSchemas: Record<string, z.ZodTypeAny> = {};

  if (config.connect !== undefined) {
    if (!isPlainObject(config.connect)) {
      throw new ShapeError(
        `connect config on "${model}.${fieldName}" must be an object of field names`,
      );
    }
    const connectSchema = buildWhereFieldsSchema(
      relatedModelName,
      config.connect as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    opSchemas["connect"] = isList
      ? z
          .union([
            connectSchema,
            z.preprocess(coerceToArray, z.array(connectSchema)),
          ])
          .optional()
      : connectSchema.optional();
  }

  if (config.connectOrCreate !== undefined) {
    if (!isPlainObject(config.connectOrCreate)) {
      throw new ShapeError(
        `connectOrCreate config on "${model}.${fieldName}" must be an object with "where" and "create"`,
      );
    }
    const coc = config.connectOrCreate as Record<string, unknown>;
    if (!coc.where || !isPlainObject(coc.where)) {
      throw new ShapeError(
        `connectOrCreate on "${model}.${fieldName}" requires "where" object`,
      );
    }
    if (!coc.create || !isPlainObject(coc.create)) {
      throw new ShapeError(
        `connectOrCreate on "${model}.${fieldName}" requires "create" object`,
      );
    }
    const whereSchema = buildWhereFieldsSchema(
      relatedModelName,
      coc.where as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    const createSchema = buildNestedDataSchema(
      relatedModelName,
      coc.create as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    const cocSchema = z
      .object({ where: whereSchema, create: createSchema })
      .strict();
    opSchemas["connectOrCreate"] = isList
      ? z
          .union([cocSchema, z.preprocess(coerceToArray, z.array(cocSchema))])
          .optional()
      : cocSchema.optional();
  }

  if (config.create !== undefined) {
    if (!isPlainObject(config.create)) {
      throw new ShapeError(
        `create config on "${model}.${fieldName}" must be an object of field names`,
      );
    }
    const createSchema = buildNestedDataSchema(
      relatedModelName,
      config.create as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    opSchemas["create"] = isList
      ? z
          .union([
            createSchema,
            z.preprocess(coerceToArray, z.array(createSchema)),
          ])
          .optional()
      : createSchema.optional();
  }

  if (config.createMany !== undefined) {
    if (!isList) {
      throw new ShapeError(
        `createMany is only valid on to-many relations ("${model}.${fieldName}")`,
      );
    }
    if (!isPlainObject(config.createMany)) {
      throw new ShapeError(
        `createMany config on "${model}.${fieldName}" must be an object`,
      );
    }
    const cmConfig = config.createMany as Record<string, unknown>;
    if (!cmConfig.data || !isPlainObject(cmConfig.data)) {
      throw new ShapeError(
        `createMany on "${model}.${fieldName}" requires "data" object`,
      );
    }
    const dataSchema = buildNestedDataSchema(
      relatedModelName,
      cmConfig.data as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    const cmSchemaFields: Record<string, z.ZodTypeAny> = {
      data: z.preprocess(coerceToArray, z.array(dataSchema)),
    };
    if ("skipDuplicates" in cmConfig) {
      cmSchemaFields["skipDuplicates"] = z.boolean().optional();
    }
    opSchemas["createMany"] = z.object(cmSchemaFields).strict().optional();
  }

  if (config.disconnect !== undefined) {
    if (config.disconnect === true) {
      if (isList) {
        throw new ShapeError(
          `disconnect on to-many relation "${model}.${fieldName}" requires field config, not true`,
        );
      }
      opSchemas["disconnect"] = z.literal(true).optional();
    } else if (isPlainObject(config.disconnect)) {
      const disconnectSchema = buildWhereFieldsSchema(
        relatedModelName,
        config.disconnect as Record<string, true>,
        typeMap,
        schemaBuilder,
      );
      if (isList) {
        opSchemas["disconnect"] = z
          .union([
            disconnectSchema,
            z.preprocess(coerceToArray, z.array(disconnectSchema)),
          ])
          .optional();
      } else {
        opSchemas["disconnect"] = z
          .union([z.literal(true), disconnectSchema])
          .optional();
      }
    } else {
      throw new ShapeError(
        `disconnect config on "${model}.${fieldName}" must be true (to-one) or an object of field names`,
      );
    }
  }

  if (config.delete !== undefined) {
    if (config.delete === true) {
      if (isList) {
        throw new ShapeError(
          `delete on to-many relation "${model}.${fieldName}" requires field config, not true`,
        );
      }
      opSchemas["delete"] = z.literal(true).optional();
    } else if (isPlainObject(config.delete)) {
      const deleteSchema = buildWhereFieldsSchema(
        relatedModelName,
        config.delete as Record<string, true>,
        typeMap,
        schemaBuilder,
      );
      if (isList) {
        opSchemas["delete"] = z
          .union([
            deleteSchema,
            z.preprocess(coerceToArray, z.array(deleteSchema)),
          ])
          .optional();
      } else {
        opSchemas["delete"] = z
          .union([z.literal(true), deleteSchema])
          .optional();
      }
    } else {
      throw new ShapeError(
        `delete config on "${model}.${fieldName}" must be true (to-one) or an object of field names`,
      );
    }
  }

  if (config.set !== undefined) {
    if (!isList) {
      throw new ShapeError(
        `set is only valid on to-many relations ("${model}.${fieldName}")`,
      );
    }
    if (!isPlainObject(config.set)) {
      throw new ShapeError(
        `set config on "${model}.${fieldName}" must be an object of field names`,
      );
    }
    const setSchema = buildWhereFieldsSchema(
      relatedModelName,
      config.set as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    opSchemas["set"] = z
      .preprocess(coerceToArray, z.array(setSchema))
      .optional();
  }

  if (config.update !== undefined) {
    if (!isPlainObject(config.update)) {
      throw new ShapeError(
        `update config on "${model}.${fieldName}" must be an object`,
      );
    }
    const updateConfig = config.update as Record<string, unknown>;
    if (isList) {
      if (!updateConfig.where || !isPlainObject(updateConfig.where)) {
        throw new ShapeError(
          `update on to-many "${model}.${fieldName}" requires "where" object`,
        );
      }
      if (!updateConfig.data || !isPlainObject(updateConfig.data)) {
        throw new ShapeError(
          `update on to-many "${model}.${fieldName}" requires "data" object`,
        );
      }
      const whereSchema = buildWhereFieldsSchema(
        relatedModelName,
        updateConfig.where as Record<string, true>,
        typeMap,
        schemaBuilder,
      );
      const dataSchema = buildNestedDataSchema(
        relatedModelName,
        updateConfig.data as Record<string, true>,
        typeMap,
        schemaBuilder,
      );
      const updateSchema = z
        .object({ where: whereSchema, data: dataSchema })
        .strict();
      opSchemas["update"] = z
        .union([
          updateSchema,
          z.preprocess(coerceToArray, z.array(updateSchema)),
        ])
        .optional();
    } else {
      const dataSchema = buildNestedDataSchema(
        relatedModelName,
        updateConfig as Record<string, true>,
        typeMap,
        schemaBuilder,
      );
      opSchemas["update"] = dataSchema.optional();
    }
  }

  if (config.upsert !== undefined) {
    if (!isPlainObject(config.upsert)) {
      throw new ShapeError(
        `upsert config on "${model}.${fieldName}" must be an object`,
      );
    }
    const upsertConfig = config.upsert as Record<string, unknown>;
    if (!upsertConfig.create || !isPlainObject(upsertConfig.create)) {
      throw new ShapeError(
        `upsert on "${model}.${fieldName}" requires "create" object`,
      );
    }
    if (!upsertConfig.update || !isPlainObject(upsertConfig.update)) {
      throw new ShapeError(
        `upsert on "${model}.${fieldName}" requires "update" object`,
      );
    }
    const createSchema = buildNestedDataSchema(
      relatedModelName,
      upsertConfig.create as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    const updateSchema = buildNestedDataSchema(
      relatedModelName,
      upsertConfig.update as Record<string, true>,
      typeMap,
      schemaBuilder,
    );

    if (isList) {
      if (!upsertConfig.where || !isPlainObject(upsertConfig.where)) {
        throw new ShapeError(
          `upsert on to-many "${model}.${fieldName}" requires "where" object`,
        );
      }
      const whereSchema = buildWhereFieldsSchema(
        relatedModelName,
        upsertConfig.where as Record<string, true>,
        typeMap,
        schemaBuilder,
      );
      const upsertSchema = z
        .object({
          where: whereSchema,
          create: createSchema,
          update: updateSchema,
        })
        .strict();
      opSchemas["upsert"] = z
        .union([
          upsertSchema,
          z.preprocess(coerceToArray, z.array(upsertSchema)),
        ])
        .optional();
    } else {
      if (upsertConfig.where) {
        const whereSchema = buildWhereFieldsSchema(
          relatedModelName,
          upsertConfig.where as Record<string, true>,
          typeMap,
          schemaBuilder,
        );
        const upsertSchema = z
          .object({
            where: whereSchema,
            create: createSchema,
            update: updateSchema,
          })
          .strict();
        opSchemas["upsert"] = upsertSchema.optional();
      } else {
        const upsertSchema = z
          .object({ create: createSchema, update: updateSchema })
          .strict();
        opSchemas["upsert"] = upsertSchema.optional();
      }
    }
  }

  if (config.updateMany !== undefined) {
    if (!isList) {
      throw new ShapeError(
        `updateMany is only valid on to-many relations ("${model}.${fieldName}")`,
      );
    }
    if (!isPlainObject(config.updateMany)) {
      throw new ShapeError(
        `updateMany config on "${model}.${fieldName}" must be an object`,
      );
    }
    const umConfig = config.updateMany as Record<string, unknown>;
    if (!umConfig.where || !isPlainObject(umConfig.where)) {
      throw new ShapeError(
        `updateMany on "${model}.${fieldName}" requires "where" object`,
      );
    }
    if (!umConfig.data || !isPlainObject(umConfig.data)) {
      throw new ShapeError(
        `updateMany on "${model}.${fieldName}" requires "data" object`,
      );
    }
    const whereSchema = buildWhereFieldsSchema(
      relatedModelName,
      umConfig.where as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    const dataSchema = buildNestedDataSchema(
      relatedModelName,
      umConfig.data as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    const umSchema = z
      .object({ where: whereSchema, data: dataSchema })
      .strict();
    opSchemas["updateMany"] = z
      .union([umSchema, z.preprocess(coerceToArray, z.array(umSchema))])
      .optional();
  }

  if (config.deleteMany !== undefined) {
    if (!isList) {
      throw new ShapeError(
        `deleteMany is only valid on to-many relations ("${model}.${fieldName}")`,
      );
    }
    if (!isPlainObject(config.deleteMany)) {
      throw new ShapeError(
        `deleteMany config on "${model}.${fieldName}" must be an object of allowed filter fields`,
      );
    }
    const filterSchema = buildWhereFieldsSchema(
      relatedModelName,
      config.deleteMany as Record<string, true>,
      typeMap,
      schemaBuilder,
    );
    opSchemas["deleteMany"] = z
      .union([
        filterSchema,
        z.preprocess(coerceToArray, z.array(filterSchema)),
        z.object({}).strict(),
      ])
      .optional();
  }

  return z.object(opSchemas).strict();
}

export function buildDataSchema(
  model: string,
  dataConfig: Record<string, true | unknown>,
  mode: "create" | "update",
  typeMap: TypeMap,
  schemaBuilder: ReturnType<typeof createSchemaBuilder>,
  zodDefaults: ZodDefaults,
): BuiltDataSchema {
  const modelFields = typeMap[model];
  if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

  const zodDefaultFields = zodDefaults[model];
  const zodDefaultSet = zodDefaultFields
    ? new Set(zodDefaultFields)
    : undefined;

  const schemaMap: Record<string, z.ZodTypeAny> = {};
  const forced: Record<string, unknown> = {};

  for (const [fieldName, value] of Object.entries(dataConfig)) {
    const fieldMeta = modelFields[fieldName];

    if (!fieldMeta) {
      if (value === true) {
        schemaMap[fieldName] = z.unknown().optional();
        continue;
      }
      throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`);
    }

    if (fieldMeta.isRelation) {
      if (!isPlainObject(value)) {
        throw new ShapeError(
          `Relation field "${fieldName}" on model "${model}" requires a relation write config object`,
        );
      }
      schemaMap[fieldName] = buildRelationWriteSchema(
        model,
        fieldName,
        fieldMeta.type,
        fieldMeta.isList,
        value as Record<string, unknown>,
        typeMap,
        schemaBuilder,
      ).optional();
      continue;
    }

    if (fieldMeta.isUpdatedAt)
      throw new ShapeError(
        `updatedAt field "${fieldName}" cannot be used in data shape`,
      );

    if (typeof value === "function") {
      let baseSchema: z.ZodTypeAny = schemaBuilder.buildBaseFieldSchema(
        model,
        fieldName,
      );
      let refined: unknown;
      try {
        refined = (value as DataFieldRefine)(baseSchema);
      } catch (err: any) {
        throw new ShapeError(
          `Invalid inline refine for "${model}.${fieldName}": ${err.message}`,
          { cause: err },
        );
      }

      if (!isZodSchema(refined)) {
        throw new ShapeError(
          `Inline refine for "${model}.${fieldName}" must return a Zod schema`,
        );
      }

      let fieldSchema: z.ZodTypeAny = refined;
      const handlesUndefined = schemaProducesValueForUndefined(fieldSchema);

      if (mode === "create") {
        if (!fieldMeta.isRequired) {
          fieldSchema = handlesUndefined
            ? fieldSchema.nullable()
            : fieldSchema.nullable().optional();
        } else if (fieldMeta.hasDefault) {
          if (!handlesUndefined) {
            fieldSchema = fieldSchema.optional();
          }
        }
      } else {
        if (!fieldMeta.isRequired) {
          fieldSchema = fieldSchema.nullable().optional();
        } else {
          fieldSchema = fieldSchema.optional();
        }
      }

      schemaMap[fieldName] = fieldSchema;
    } else if (value === true) {
      let fieldSchema: z.ZodTypeAny = schemaBuilder.buildFieldSchema(
        model,
        fieldName,
      );
      const isZodDefaultField =
        zodDefaultSet !== undefined && zodDefaultSet.has(fieldName);

      if (mode === "create") {
        if (!fieldMeta.isRequired) {
          fieldSchema = isZodDefaultField
            ? fieldSchema.nullable()
            : fieldSchema.nullable().optional();
        } else if (fieldMeta.hasDefault) {
          if (!isZodDefaultField) {
            fieldSchema = fieldSchema.optional();
          }
        }
      } else {
        if (!fieldMeta.isRequired) {
          fieldSchema = fieldSchema.nullable().optional();
        } else {
          fieldSchema = fieldSchema.optional();
        }
      }

      schemaMap[fieldName] = fieldSchema;
    } else {
      const actualValue = isForcedValue(value) ? value.value : value;
      let fieldSchema: z.ZodTypeAny = schemaBuilder.buildFieldSchema(
        model,
        fieldName,
      );
      if (!fieldMeta.isRequired) {
        fieldSchema = fieldSchema.nullable();
      }
      let parsed: unknown;
      try {
        parsed = fieldSchema.parse(actualValue);
      } catch (err: any) {
        throw new ShapeError(
          `Invalid forced data value for "${model}.${fieldName}": ${err.message}`,
        );
      }
      forced[fieldName] = parsed;
    }
  }

  if (mode === "create" && zodDefaultFields) {
    for (const fieldName of zodDefaultFields) {
      if (fieldName in dataConfig) continue;
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta) continue;
      if (fieldMeta.isRelation) continue;
      if (fieldMeta.isUpdatedAt) continue;

      const fieldSchema = schemaBuilder.buildFieldSchema(model, fieldName);
      const result = fieldSchema.safeParse(undefined);
      if (result.success && result.data !== undefined) {
        forced[fieldName] = result.data;
      } else {
        throw new ShapeError(
          `Field "${fieldName}" on model "${model}" has @zod default/catch but its schema does not produce a value for undefined input`,
        );
      }
    }
  }

  return {
    schema: z.object(schemaMap).strict(),
    forced,
  };
}

export function validateAndMergeData(
  bodyData: unknown,
  cached: BuiltDataSchema,
  method: string,
): Record<string, unknown> {
  if (bodyData === undefined || bodyData === null) {
    throw new ShapeError(`${method} requires "data" in request body`);
  }
  const validated = cached.schema.parse(bodyData);
  return { ...validated, ...deepClone(cached.forced) };
}

export function hasDataRefines(
  dataConfig: Record<string, true | unknown>,
): boolean {
  for (const value of Object.values(dataConfig)) {
    if (typeof value === "function") return true;
  }
  return false;
}
