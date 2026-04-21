import { z } from "zod";
import type { FieldMeta, EnumMap } from "../shared/types.js";
import { ShapeError } from "../shared/errors.js";
import { coerceToArray } from "../shared/utils.js";
import {
  wrapWithInputCoercion,
  type ScalarBaseMap,
} from "../shared/scalar-base.js";

const SCALAR_OPERATORS: Record<string, Set<string>> = {
  String: new Set([
    "equals",
    "not",
    "contains",
    "startsWith",
    "endsWith",
    "in",
    "notIn",
    "gt",
    "gte",
    "lt",
    "lte",
    "search",
  ]),
  Int: new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  Float: new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  Decimal: new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  BigInt: new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  Boolean: new Set(["equals", "not"]),
  DateTime: new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  Bytes: new Set([]),
  Json: new Set([
    "equals",
    "not",
    "path",
    "string_contains",
    "string_starts_with",
    "string_ends_with",
    "array_contains",
    "array_starts_with",
    "array_ends_with",
  ]),
};

const SCALAR_LIST_OPERATORS = new Set([
  "has",
  "hasEvery",
  "hasSome",
  "isEmpty",
  "equals",
]);

const ENUM_OPERATORS = new Set(["equals", "not", "in", "notIn"]);

const NUMERIC_TYPES = new Set(["Int", "Float", "Decimal", "BigInt"]);
const COMPARABLE_TYPES = new Set([
  "Int",
  "Float",
  "Decimal",
  "BigInt",
  "String",
  "DateTime",
]);

const JSON_STRING_OPERATORS = new Set([
  "string_contains",
  "string_starts_with",
  "string_ends_with",
]);

const JSON_ARRAY_OPERATORS = new Set([
  "array_contains",
  "array_starts_with",
  "array_ends_with",
]);

export { NUMERIC_TYPES, COMPARABLE_TYPES };

export function getSupportedOperators(fieldMeta: FieldMeta): string[] {
  if (fieldMeta.isList) return [...SCALAR_LIST_OPERATORS];
  if (fieldMeta.isEnum) return [...ENUM_OPERATORS];
  const ops = SCALAR_OPERATORS[fieldMeta.type];
  if (!ops) return [];
  return [...ops];
}

export function createBaseType(
  fieldMeta: FieldMeta,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
): z.ZodTypeAny {
  let base: z.ZodTypeAny;

  if (fieldMeta.isUnsupported) {
    base = z.unknown();
  } else if (fieldMeta.isEnum) {
    const values = enumMap[fieldMeta.type];
    if (!values || values.length === 0) {
      throw new ShapeError(`Unknown enum: ${fieldMeta.type}`);
    }
    base = z.enum(values as unknown as [string, ...string[]]);
  } else {
    const factory = scalarBase[fieldMeta.type];
    if (!factory) {
      throw new ShapeError(`Unknown scalar type: ${fieldMeta.type}`);
    }
    base = factory();
  }

  if (fieldMeta.isList) {
    base = z.array(base);
  }

  return base;
}

export function createScalarListOperatorSchema(
  fieldMeta: FieldMeta,
  operator: string,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
): z.ZodTypeAny {
  if (!SCALAR_LIST_OPERATORS.has(operator)) {
    throw new ShapeError(
      `Operator "${operator}" not supported for scalar list fields`,
    );
  }

  if (operator === "isEmpty") {
    return z.boolean();
  }

  const itemMeta: FieldMeta = { ...fieldMeta, isList: false };
  const itemBase = createBaseType(itemMeta, enumMap, scalarBase);

  if (operator === "has") {
    return !fieldMeta.isRequired ? z.union([itemBase, z.null()]) : itemBase;
  }

  if (operator === "equals") {
    const arrSchema = z.array(itemBase);
    return fieldMeta.isRequired
      ? z.preprocess(coerceToArray, arrSchema)
      : z.union([z.preprocess(coerceToArray, arrSchema), z.null()]);
  }

  return z.preprocess(coerceToArray, z.array(itemBase));
}

function createJsonOperatorSchema(
  fieldMeta: FieldMeta,
  operator: string,
): z.ZodTypeAny {
  const jsonValue = z.unknown();

  if (operator === "equals") {
    return !fieldMeta.isRequired ? z.union([jsonValue, z.null()]) : jsonValue;
  }

  if (operator === "path") {
    return z.preprocess(coerceToArray, z.array(z.string()).min(1));
  }

  if (JSON_STRING_OPERATORS.has(operator)) {
    return z.string();
  }

  if (JSON_ARRAY_OPERATORS.has(operator)) {
    return jsonValue;
  }

  throw new ShapeError(
    `Operator "${operator}" not supported for Json fields`,
  );
}

function buildNotFilterSchema(
  fieldMeta: FieldMeta,
  scalarSchema: z.ZodTypeAny,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
): z.ZodTypeAny {
  const allOps = getSupportedOperators(fieldMeta);
  const nestedOps = allOps.filter((o) => o !== "not");

  if (nestedOps.length === 0) return scalarSchema;

  const nestedSchemas: Record<string, z.ZodTypeAny> = {};
  for (const op of nestedOps) {
    nestedSchemas[op] = createOperatorSchema(
      fieldMeta,
      op,
      enumMap,
      scalarBase,
    ).optional();
  }

  const nestedKeys = Object.keys(nestedSchemas);
  const nestedObj = z
    .object(nestedSchemas)
    .strict()
    .refine(
      (v) =>
        nestedKeys.some(
          (k) => (v as Record<string, unknown>)[k] !== undefined,
        ),
      { message: "not filter must specify at least one operator" },
    );

  return z.union([scalarSchema, nestedObj]);
}

export function createOperatorSchema(
  fieldMeta: FieldMeta,
  operator: string,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
): z.ZodTypeAny {
  if (fieldMeta.isList) {
    return createScalarListOperatorSchema(
      fieldMeta,
      operator,
      enumMap,
      scalarBase,
    );
  }

  if (fieldMeta.isEnum) {
    const values = enumMap[fieldMeta.type];
    if (!values || values.length === 0) {
      throw new ShapeError(`Unknown enum: ${fieldMeta.type}`);
    }
    if (!ENUM_OPERATORS.has(operator)) {
      throw new ShapeError(
        `Operator "${operator}" not supported for enum fields`,
      );
    }
    const enumSchema = z.enum(values as unknown as [string, ...string[]]);
    if (operator === "equals") {
      return !fieldMeta.isRequired
        ? z.union([enumSchema, z.null()])
        : enumSchema;
    }
    if (operator === "not") {
      const scalarSchema = !fieldMeta.isRequired
        ? z.union([enumSchema, z.null()])
        : enumSchema;
      return buildNotFilterSchema(fieldMeta, scalarSchema, enumMap, scalarBase);
    }
    const itemSchema = !fieldMeta.isRequired
      ? z.union([enumSchema, z.null()])
      : enumSchema;
    return z.preprocess(coerceToArray, z.array(itemSchema));
  }

  if (fieldMeta.type === "Json") {
    const supportedOps = SCALAR_OPERATORS["Json"];
    if (!supportedOps || !supportedOps.has(operator)) {
      throw new ShapeError(
        `Operator "${operator}" not supported for type "Json"`,
      );
    }
    if (operator === "not") {
      const jsonValue = z.unknown();
      const scalarSchema = !fieldMeta.isRequired
        ? z.union([jsonValue, z.null()])
        : jsonValue;
      return buildNotFilterSchema(fieldMeta, scalarSchema, enumMap, scalarBase);
    }
    return createJsonOperatorSchema(fieldMeta, operator);
  }

  const supportedOps = SCALAR_OPERATORS[fieldMeta.type];
  if (!supportedOps) {
    throw new ShapeError(`Unknown scalar type for operator: ${fieldMeta.type}`);
  }
  if (supportedOps.size === 0) {
    throw new ShapeError(
      `Type "${fieldMeta.type}" does not support filter operators`,
    );
  }
  if (!supportedOps.has(operator)) {
    throw new ShapeError(
      `Operator "${operator}" not supported for type "${fieldMeta.type}"`,
    );
  }

  const factory = scalarBase[fieldMeta.type];
  if (!factory) {
    throw new ShapeError(`Unknown scalar type: ${fieldMeta.type}`);
  }

  const scalar = factory();
  const coerced = wrapWithInputCoercion(fieldMeta.type, false, scalar);

  if (operator === "equals") {
    return !fieldMeta.isRequired ? z.union([coerced, z.null()]) : coerced;
  }
  if (operator === "not") {
    const scalarSchema = !fieldMeta.isRequired
      ? z.union([coerced, z.null()])
      : coerced;
    return buildNotFilterSchema(fieldMeta, scalarSchema, enumMap, scalarBase);
  }
  if (operator === "in" || operator === "notIn") {
    const itemSchema = !fieldMeta.isRequired
      ? z.union([coerced, z.null()])
      : coerced;
    return z.preprocess(coerceToArray, z.array(itemSchema));
  }
  return coerced;
}