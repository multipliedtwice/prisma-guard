import { z } from "zod";
import type {
  TypeMap,
  EnumMap,
  UniqueMap,
  OrderByFieldConfig,
  UniqueConstraint,
} from "../shared/types.js";
import { ShapeError } from "../shared/errors.js";
import {
  createBaseType,
  getSupportedOperators,
  createOperatorSchema,
  NUMERIC_TYPES,
  COMPARABLE_TYPES,
} from "./zod-type-map.js";
import { coerceToArray } from "../shared/utils.js";
import {
  wrapWithInputCoercion,
  type ScalarBaseMap,
} from "../shared/scalar-base.js";

const UNSUPPORTED_BY_TYPES = new Set(["Json", "Bytes"]);

function requireConfigTrue(
  config: Record<string, unknown>,
  context: string,
): void {
  for (const [key, value] of Object.entries(config)) {
    if (value !== true) {
      throw new ShapeError(
        `Config value for "${key}" in ${context} must be true, got ${typeof value}`,
      );
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatUniqueConstraint(constraint: UniqueConstraint): string {
  return constraint.fields.length === 1
    ? constraint.selector
    : `${constraint.selector}(${constraint.fields.join(", ")})`;
}

function formatUniqueConstraints(
  constraints: readonly UniqueConstraint[],
): string {
  return constraints.map(formatUniqueConstraint).join(" | ");
}

export function createArgsBuilder(
  typeMap: TypeMap,
  enumMap: EnumMap,
  uniqueMap: UniqueMap,
  scalarBase: ScalarBaseMap,
) {
  const sortEnum = z.enum(["asc", "desc"]);
  const nullsEnum = z.enum(["first", "last"]);
  const sortWithNulls = z
    .object({ sort: sortEnum, nulls: nullsEnum.optional() })
    .strict();
  const scalarOrderSchema = z.union([sortEnum, sortWithNulls]);

  function validateScalarOrderByField(
    fieldName: string,
    model: string,
    modelFields: Record<
      string,
      { type: string; isList: boolean; isRelation: boolean }
    >,
  ): void {
    const fieldMeta = modelFields[fieldName];
    if (!fieldMeta)
      throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`);
    if (fieldMeta.isRelation)
      throw new ShapeError(
        `Relation field "${fieldName}" in orderBy requires a nested config object, not true`,
      );
    if (fieldMeta.type === "Json")
      throw new ShapeError(
        `Json field "${fieldName}" cannot be used in orderBy`,
      );
    if (fieldMeta.isList)
      throw new ShapeError(
        `List field "${fieldName}" cannot be used in orderBy`,
      );
  }

  function buildOrderBySchema(
    model: string,
    orderByConfig: Record<string, OrderByFieldConfig>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};

    for (const [fieldName, config] of Object.entries(orderByConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}"`,
        );

      if (config === true) {
        validateScalarOrderByField(fieldName, model, modelFields);
        fieldSchemas[fieldName] = scalarOrderSchema.optional();
        continue;
      }

      if (!isPlainRecord(config)) {
        throw new ShapeError(
          `orderBy config for "${fieldName}" on model "${model}" must be true or a relation aggregate object`,
        );
      }

      if (!fieldMeta.isRelation) {
        const allowedOps = getSupportedOperators(
          fieldMeta.type,
          fieldMeta.isList,
        );
        const opSchemas: Record<string, z.ZodTypeAny> = {};

        for (const [op, enabled] of Object.entries(config)) {
          if (enabled !== true) {
            throw new ShapeError(
              `orderBy operator config for "${model}.${fieldName}.${op}" must be true`,
            );
          }

          if (!allowedOps.includes(op)) {
            throw new ShapeError(
              `Operator "${op}" not supported for orderBy field "${model}.${fieldName}"`,
            );
          }

          opSchemas[op] = scalarOrderSchema.optional();
        }

        const opKeys = Object.keys(opSchemas);
        fieldSchemas[fieldName] = z
          .object(opSchemas)
          .strict()
          .refine(
            (v) =>
              opKeys.some(
                (k) => (v as Record<string, unknown>)[k] !== undefined,
              ),
            {
              message: `orderBy field "${fieldName}" must specify at least one operator`,
            },
          )
          .optional();

        continue;
      }

      if (fieldMeta.isList) {
        if (!("_count" in config)) {
          throw new ShapeError(
            `To-many relation orderBy "${fieldName}" only supports _count`,
          );
        }

        if (config._count !== true) {
          throw new ShapeError(
            `orderBy relation aggregate "${fieldName}._count" must be true`,
          );
        }

        fieldSchemas[fieldName] = z
          .object({
            _count: sortEnum.optional(),
          })
          .strict()
          .optional();
        continue;
      }

      const nested = buildOrderBySchema(
        fieldMeta.type,
        config as Record<string, OrderByFieldConfig>,
      );
      fieldSchemas[fieldName] = nested;
    }

    const fieldKeys = Object.keys(fieldSchemas);
    const singleSchema = z
      .object(fieldSchemas)
      .strict()
      .refine(
        (v) =>
          fieldKeys.some(
            (k) => (v as Record<string, unknown>)[k] !== undefined,
          ),
        { message: "orderBy must specify at least one field" },
      );

    return z
      .union([
        singleSchema,
        z.preprocess(coerceToArray, z.array(singleSchema).min(1)),
      ])
      .optional();
  }

  function buildTakeSchema(
    config: number | { max: number; default?: number },
  ): z.ZodTypeAny {
    if (typeof config === "number") {
      if (!Number.isFinite(config) || !Number.isInteger(config)) {
        throw new ShapeError(`take must be a finite integer, got ${config}`);
      }

      if (config <= 0) {
        throw new ShapeError("take must be a positive integer");
      }

      return z.literal(config).optional();
    }

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new ShapeError("take config must be a number or { max, default? }");
    }

    if (!Number.isFinite(config.max) || !Number.isInteger(config.max)) {
      throw new ShapeError(
        `take.max must be a finite integer, got ${config.max}`,
      );
    }

    if (config.max <= 0) {
      throw new ShapeError("take.max must be a positive integer");
    }

    if (config.default !== undefined) {
      if (
        !Number.isFinite(config.default) ||
        !Number.isInteger(config.default)
      ) {
        throw new ShapeError(
          `take.default must be a finite integer, got ${config.default}`,
        );
      }

      if (config.default <= 0) {
        throw new ShapeError("take.default must be a positive integer");
      }

      if (config.default > config.max) {
        throw new ShapeError("take.default cannot exceed take.max");
      }

      return z.number().int().min(1).max(config.max).default(config.default);
    }

    return z.number().int().min(1).max(config.max).optional();
  }

  function buildCursorFieldSchema(
    model: string,
    fieldName: string,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const fieldMeta = modelFields[fieldName];
    if (!fieldMeta) {
      throw new ShapeError(
        `Unknown field "${fieldName}" on model "${model}" in cursor`,
      );
    }

    if (fieldMeta.isRelation) {
      throw new ShapeError(
        `Relation field "${fieldName}" cannot be used in cursor`,
      );
    }

    if (fieldMeta.isList) {
      throw new ShapeError(
        `List field "${fieldName}" cannot be used in cursor`,
      );
    }

    const base = createBaseType(fieldMeta, enumMap, scalarBase);

    if (
      !fieldMeta.isEnum &&
      !fieldMeta.isRelation &&
      !fieldMeta.isUnsupported
    ) {
      return wrapWithInputCoercion(fieldMeta.type, fieldMeta.isList, base);
    }

    return base;
  }

  function cursorConfigMatchesConstraint(
    cursorConfig: Record<string, unknown>,
    constraint: UniqueConstraint,
  ): boolean {
    if (!(constraint.selector in cursorConfig)) return false;

    const value = cursorConfig[constraint.selector];

    if (constraint.fields.length === 1) {
      return value === true;
    }

    if (!isPlainRecord(value)) return false;

    const keys = Object.keys(value);

    if (keys.length !== constraint.fields.length) return false;

    return constraint.fields.every((field) => value[field] === true);
  }

  function getUniqueConstraints(model: string): readonly UniqueConstraint[] {
    const constraints = uniqueMap[model];

    if (constraints && constraints.length > 0) {
      return constraints;
    }

    const modelFields = typeMap[model];

    if (!modelFields) {
      throw new ShapeError(`Unknown model: ${model}`);
    }

    const inferred: UniqueConstraint[] = [];

    for (const [fieldName, fieldMeta] of Object.entries(modelFields)) {
      if (fieldMeta.isRelation) continue;

      if (fieldMeta.isId || fieldMeta.isUnique) {
        inferred.push({
          selector: fieldName,
          fields: [fieldName],
        });
      }
    }

    return inferred;
  }

  function buildCursorSchema(
    model: string,
    cursorConfig: Record<string, unknown>,
  ): z.ZodTypeAny {
    const constraints = getUniqueConstraints(model);

    if (constraints.length === 0) {
      throw new ShapeError(
        `cursor on model "${model}" requires at least one unique constraint`,
      );
    }

    const matching = constraints.find((constraint) =>
      cursorConfigMatchesConstraint(cursorConfig, constraint),
    );

    if (!matching) {
      throw new ShapeError(
        `cursor on model "${model}" must exactly match a unique selector: ${formatUniqueConstraints(constraints)}`,
      );
    }

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};

    if (matching.fields.length === 1) {
      fieldSchemas[matching.selector] = buildCursorFieldSchema(
        model,
        matching.fields[0],
      ).optional();
    } else {
      const nestedSchemas: Record<string, z.ZodTypeAny> = {};

      for (const field of matching.fields) {
        nestedSchemas[field] = buildCursorFieldSchema(model, field);
      }

      fieldSchemas[matching.selector] = z
        .object(nestedSchemas)
        .strict()
        .optional();
    }

    return z
      .object(fieldSchemas)
      .strict()
      .refine(
        (v) => (v as Record<string, unknown>)[matching.selector] !== undefined,
        { message: `cursor must specify "${matching.selector}"` },
      )
      .optional();
  }

  function buildDistinctSchema(
    model: string,
    distinctConfig: string[],
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    if (!Array.isArray(distinctConfig) || distinctConfig.length === 0) {
      throw new ShapeError(
        `distinct on model "${model}" must be a non-empty array of scalar fields`,
      );
    }

    const allowedFields = new Set<string>();

    for (const fieldName of distinctConfig) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in distinct`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in distinct`,
        );
      allowedFields.add(fieldName);
    }

    return z
      .union([
        z.enum([...allowedFields] as [string, ...string[]]),
        z.array(z.enum([...allowedFields] as [string, ...string[]])).min(1),
      ])
      .optional();
  }

  function buildBySchema(model: string, byConfig: string[]): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    if (!Array.isArray(byConfig) || byConfig.length === 0) {
      throw new ShapeError(
        `groupBy "by" on model "${model}" must be a non-empty array`,
      );
    }

    const allowedFields = new Set<string>();

    for (const fieldName of byConfig) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in groupBy by`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in groupBy by`,
        );
      if (fieldMeta.isList)
        throw new ShapeError(
          `List field "${fieldName}" cannot be used in groupBy by`,
        );
      if (UNSUPPORTED_BY_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `${fieldMeta.type} field "${fieldName}" cannot be used in groupBy by`,
        );
      }
      allowedFields.add(fieldName);
    }

    return z.array(z.enum([...allowedFields] as [string, ...string[]])).min(1);
  }

  function buildHavingSchema(
    model: string,
    havingConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    requireConfigTrue(havingConfig, `having on model "${model}"`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};

    for (const fieldName of Object.keys(havingConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in having`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in having`,
        );
      if (fieldMeta.isList)
        throw new ShapeError(
          `List field "${fieldName}" cannot be used in having`,
        );
      if (UNSUPPORTED_BY_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `${fieldMeta.type} field "${fieldName}" cannot be used in having`,
        );
      }

      const allowedOps = getSupportedOperators(
        fieldMeta.type,
        fieldMeta.isList,
      );
      const opSchemas: Record<string, z.ZodTypeAny> = {};

      for (const op of allowedOps) {
        opSchemas[op] = createOperatorSchema(
          fieldMeta,
          op,
          enumMap,
          scalarBase,
        ).optional();
      }

      if (fieldMeta.type === "String") {
        opSchemas.mode = z.enum(["default", "insensitive"]).optional();
      }

      const opKeys = Object.keys(opSchemas).filter((key) => key !== "mode");

      fieldSchemas[fieldName] = z
        .object(opSchemas)
        .strict()
        .refine(
          (v) =>
            opKeys.some((k) => (v as Record<string, unknown>)[k] !== undefined),
          {
            message: `having field "${fieldName}" must specify at least one operator`,
          },
        )
        .optional();
    }

    const fieldKeys = Object.keys(fieldSchemas);

    return z
      .object(fieldSchemas)
      .strict()
      .refine(
        (v) =>
          fieldKeys.some(
            (k) => (v as Record<string, unknown>)[k] !== undefined,
          ),
        { message: "having must specify at least one field" },
      )
      .optional();
  }

  function buildAggregateFieldSchema(
    model: string,
    op: "_avg" | "_sum" | "_min" | "_max",
    config: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    requireConfigTrue(config, `${op} on model "${model}"`);

    const allowedTypes =
      op === "_avg" || op === "_sum" ? NUMERIC_TYPES : COMPARABLE_TYPES;

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};

    for (const fieldName of Object.keys(config)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in ${op}`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in ${op}`,
        );
      if (fieldMeta.isList)
        throw new ShapeError(
          `List field "${fieldName}" cannot be used in ${op}`,
        );
      if (!allowedTypes.has(fieldMeta.type)) {
        throw new ShapeError(
          `Field "${fieldName}" of type "${fieldMeta.type}" cannot be used in ${op}`,
        );
      }

      fieldSchemas[fieldName] = z.literal(true).optional();
    }

    const aggregateFieldKeys = Object.keys(fieldSchemas);
    return z
      .object(fieldSchemas)
      .strict()
      .refine(
        (v) =>
          aggregateFieldKeys.some(
            (k) => (v as Record<string, unknown>)[k] !== undefined,
          ),
        { message: `${op} must specify at least one field` },
      )
      .optional();
  }

  function buildCountFieldSchema(
    model: string,
    config: true | Record<string, true>,
    context: string,
  ): z.ZodTypeAny {
    if (config === true) {
      return z.literal(true).optional();
    }

    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    requireConfigTrue(config, `${context} on model "${model}"`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    for (const fieldName of Object.keys(config)) {
      if (fieldName !== "_all") {
        const fieldMeta = modelFields[fieldName];
        if (!fieldMeta)
          throw new ShapeError(
            `Unknown field "${fieldName}" on model "${model}" in ${context}`,
          );
        if (fieldMeta.isRelation)
          throw new ShapeError(
            `Relation field "${fieldName}" cannot be used in ${context}`,
          );
      }
      fieldSchemas[fieldName] = z.literal(true).optional();
    }

    const countFieldKeys = Object.keys(fieldSchemas);
    return z
      .object(fieldSchemas)
      .strict()
      .refine(
        (v) =>
          countFieldKeys.some(
            (k) => (v as Record<string, unknown>)[k] !== undefined,
          ),
        { message: `${context} must specify at least one field` },
      )
      .optional();
  }

  function buildCountSelectSchema(
    model: string,
    selectConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    requireConfigTrue(selectConfig, `count select on model "${model}"`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    for (const fieldName of Object.keys(selectConfig)) {
      if (fieldName === "_all") {
        fieldSchemas._all = z.literal(true).optional();
        continue;
      }
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in count select`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in count select`,
        );
      fieldSchemas[fieldName] = z.literal(true).optional();
    }

    const countSelectKeys = Object.keys(fieldSchemas);
    return z
      .object(fieldSchemas)
      .strict()
      .refine(
        (v) =>
          countSelectKeys.some(
            (k) => (v as Record<string, unknown>)[k] !== undefined,
          ),
        { message: "count select must specify at least one field" },
      )
      .optional();
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
  };
}
