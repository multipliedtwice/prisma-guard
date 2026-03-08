import { z } from "zod";
import type {
  TypeMap,
  EnumMap,
  UniqueMap,
  QueryMethod,
  ShapeConfig,
  ShapeOrFn,
  NestedIncludeArgs,
  NestedSelectArgs,
  QuerySchema,
} from "../shared/types.js";
import { ShapeError, CallerError } from "../shared/errors.js";
import { SHAPE_CONFIG_KEYS } from "../shared/constants.js";
import { matchCallerPattern } from "../shared/match-caller.js";
import { requireContext } from "./policy.js";
import {
  createOperatorSchema,
  createBaseType,
  getSupportedOperators,
  NUMERIC_TYPES,
  COMPARABLE_TYPES,
} from "./zod-type-map.js";

const METHOD_ALLOWED_ARGS: Record<QueryMethod, Set<string>> = {
  findMany: new Set([
    "where",
    "include",
    "select",
    "orderBy",
    "cursor",
    "take",
    "skip",
    "distinct",
  ]),
  findFirst: new Set([
    "where",
    "include",
    "select",
    "orderBy",
    "cursor",
    "take",
    "skip",
    "distinct",
  ]),
  findFirstOrThrow: new Set([
    "where",
    "include",
    "select",
    "orderBy",
    "cursor",
    "take",
    "skip",
    "distinct",
  ]),
  findUnique: new Set(["where", "include", "select"]),
  findUniqueOrThrow: new Set(["where", "include", "select"]),
  count: new Set(["where", "select", "cursor", "orderBy", "skip", "take"]),
  aggregate: new Set([
    "where",
    "orderBy",
    "cursor",
    "take",
    "skip",
    "_count",
    "_avg",
    "_sum",
    "_min",
    "_max",
  ]),
  groupBy: new Set([
    "where",
    "by",
    "having",
    "_count",
    "_avg",
    "_sum",
    "_min",
    "_max",
    "orderBy",
    "take",
    "skip",
  ]),
};

const UNIQUE_WHERE_METHODS: Set<QueryMethod> = new Set([
  "findUnique",
  "findUniqueOrThrow",
]);

const STRING_MODE_OPS = new Set([
  "contains",
  "startsWith",
  "endsWith",
  "equals",
]);

const UNSUPPORTED_WHERE_TYPES = new Set(["Json", "Bytes"]);
const UNSUPPORTED_BY_TYPES = new Set(["Json", "Bytes"]);

const KNOWN_NESTED_INCLUDE_KEYS = new Set([
  "where",
  "include",
  "select",
  "orderBy",
  "cursor",
  "take",
  "skip",
]);
const KNOWN_NESTED_SELECT_KEYS = new Set([
  "select",
  "where",
  "orderBy",
  "cursor",
  "take",
  "skip",
]);
const KNOWN_COUNT_SELECT_ENTRY_KEYS = new Set(["where"]);

export interface ForcedTree {
  where?: Record<string, unknown>;
  include?: Record<string, ForcedTree>;
  select?: Record<string, ForcedTree>;
  _countWhere?: Record<string, Record<string, unknown>>;
}

export interface BuiltShape {
  zodSchema: z.ZodObject<any>;
  forcedWhere: Record<string, unknown>;
  forcedIncludeTree: Record<string, ForcedTree>;
  forcedSelectTree: Record<string, ForcedTree>;
  forcedIncludeCountWhere: Record<string, Record<string, unknown>>;
  forcedSelectCountWhere: Record<string, Record<string, unknown>>;
}

export interface BuiltIncludeResult {
  schema: z.ZodTypeAny;
  forcedTree: Record<string, ForcedTree>;
  forcedCountWhere: Record<string, Record<string, unknown>>;
}

export interface BuiltSelectResult {
  schema: z.ZodTypeAny;
  forcedTree: Record<string, ForcedTree>;
  forcedCountWhere: Record<string, Record<string, unknown>>;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function mergeForced(
  where: Record<string, unknown> | undefined,
  forced: Record<string, unknown>,
): Record<string, unknown> {
  if (!where) return forced;
  return { AND: [where, forced] };
}

export function mergeUniqueForced(
  where: Record<string, unknown> | undefined,
  forced: Record<string, unknown>,
): Record<string, unknown> {
  if (!where) return { ...forced };
  return { ...where, AND: [forced] };
}

export function applyBuiltShape(
  built: BuiltShape,
  body: unknown,
  isUniqueMethod: boolean,
): Record<string, unknown> {
  const validated = built.zodSchema.parse(body) as Record<string, unknown>;

  if (Object.keys(built.forcedWhere).length > 0) {
    const cloned = structuredClone(built.forcedWhere);
    validated.where = isUniqueMethod
      ? mergeUniqueForced(
          validated.where as Record<string, unknown> | undefined,
          cloned,
        )
      : mergeForced(
          validated.where as Record<string, unknown> | undefined,
          cloned,
        );
  }

  if (Object.keys(built.forcedIncludeTree).length > 0) {
    applyForcedTree(validated, "include", built.forcedIncludeTree);
  }

  if (Object.keys(built.forcedSelectTree).length > 0) {
    applyForcedTree(validated, "select", built.forcedSelectTree);
  }

  if (Object.keys(built.forcedIncludeCountWhere).length > 0) {
    const includeContainer = validated.include as
      | Record<string, unknown>
      | undefined;
    if (includeContainer) {
      applyForcedCountWhere(includeContainer, built.forcedIncludeCountWhere);
    }
  }

  if (Object.keys(built.forcedSelectCountWhere).length > 0) {
    const selectContainer = validated.select as
      | Record<string, unknown>
      | undefined;
    if (selectContainer) {
      applyForcedCountWhere(selectContainer, built.forcedSelectCountWhere);
    }
  }

  return validated;
}

export function applyForcedTree(
  validated: Record<string, unknown>,
  key: "include" | "select",
  tree: Record<string, ForcedTree>,
): void {
  const container = validated[key] as Record<string, unknown> | undefined;
  if (!container) return;

  for (const [relName, forced] of Object.entries(tree)) {
    const relVal = container[relName];
    if (relVal === undefined) continue;

    if (relVal === true) {
      const expanded: Record<string, unknown> = {};
      if (forced.where) expanded.where = structuredClone(forced.where);
      if (forced.include) {
        expanded.include = buildForcedOnlyContainer(forced.include);
        applyForcedTree(expanded, "include", forced.include);
      }
      if (forced.select) {
        expanded.select = buildForcedOnlyContainer(forced.select);
        applyForcedTree(expanded, "select", forced.select);
      }
      if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
        const countSelect: Record<string, unknown> = {};
        for (const [countRel, countForced] of Object.entries(
          forced._countWhere,
        )) {
          countSelect[countRel] = { where: structuredClone(countForced) };
        }
        expanded._count = { select: countSelect };
      }
      if (expanded.include && expanded.select) {
        throw new ShapeError(
          `Forced tree for relation "${relName}" produces both "include" and "select". Prisma does not allow both at the same level.`,
        );
      }
      container[relName] = Object.keys(expanded).length > 0 ? expanded : true;
      continue;
    }

    if (isPlainObject(relVal)) {
      const relObj = relVal as Record<string, unknown>;
      if (forced.where) {
        relObj.where = mergeForced(
          relObj.where as Record<string, unknown> | undefined,
          structuredClone(forced.where),
        );
      }
      if (forced.include) {
        if (!relObj.include)
          relObj.include = buildForcedOnlyContainer(forced.include);
        applyForcedTree(relObj, "include", forced.include);
      }
      if (forced.select) {
        if (!relObj.select)
          relObj.select = buildForcedOnlyContainer(forced.select);
        applyForcedTree(relObj, "select", forced.select);
      }
      if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
        applyForcedCountWhere(relObj, forced._countWhere);
      }
      if (relObj.include && relObj.select) {
        throw new ShapeError(
          `Relation "${relName}" has both "include" and "select" after forced tree merge. Prisma does not allow both at the same level.`,
        );
      }
    }
  }
}

export function buildForcedOnlyContainer(
  tree: Record<string, ForcedTree>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [relName, forced] of Object.entries(tree)) {
    const nested: Record<string, unknown> = {};
    if (forced.where) nested.where = structuredClone(forced.where);
    if (forced.include)
      nested.include = buildForcedOnlyContainer(forced.include);
    if (forced.select) nested.select = buildForcedOnlyContainer(forced.select);
    if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
      const countSelect: Record<string, unknown> = {};
      for (const [countRel, countForced] of Object.entries(
        forced._countWhere,
      )) {
        countSelect[countRel] = { where: structuredClone(countForced) };
      }
      nested._count = { select: countSelect };
    }
    result[relName] = Object.keys(nested).length > 0 ? nested : true;
  }
  return result;
}

export function applyForcedCountWhere(
  container: Record<string, unknown>,
  forcedCountWhere: Record<string, Record<string, unknown>>,
): void {
  const countVal = container._count;
  if (!countVal || countVal === true || !isPlainObject(countVal)) return;
  const countObj = countVal as Record<string, unknown>;
  const selectVal = countObj.select;
  if (!selectVal || !isPlainObject(selectVal)) return;
  const selectObj = selectVal as Record<string, unknown>;

  for (const [relName, forced] of Object.entries(forcedCountWhere)) {
    const relVal = selectObj[relName];
    if (relVal === undefined) continue;

    if (relVal === true) {
      selectObj[relName] = { where: structuredClone(forced) };
    } else if (isPlainObject(relVal)) {
      const relObj = relVal as Record<string, unknown>;
      relObj.where = mergeForced(
        relObj.where as Record<string, unknown> | undefined,
        structuredClone(forced),
      );
    }
  }
}

export function collectWhereFieldKeys(
  where: Record<string, unknown>,
): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(where)) {
    if (key === "AND") {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (isPlainObject(item)) {
          for (const k of collectWhereFieldKeys(item)) keys.add(k);
        }
      }
    } else if (key !== "OR" && key !== "NOT") {
      keys.add(key);
    }
  }
  return keys;
}

export function validateResolvedUniqueWhere(
  model: string,
  where: Record<string, unknown>,
  method: string,
  uniqueMap: UniqueMap,
): void {
  const constraints = uniqueMap[model];
  if (!constraints || constraints.length === 0) return;

  const fieldKeys = collectWhereFieldKeys(where);
  const covered = constraints.some((constraint) =>
    constraint.every((field) => fieldKeys.has(field)),
  );

  if (!covered) {
    const constraintDesc = constraints
      .map((c) => `(${c.join(", ")})`)
      .join(" | ");
    throw new ShapeError(
      `${method} on model "${model}" requires resolved where to cover a unique constraint: ${constraintDesc}`,
    );
  }
}

export function validateUniqueEquality(
  model: string,
  where: Record<string, Record<string, true | unknown>>,
  method: string,
  uniqueMap: UniqueMap,
): void {
  const constraints = uniqueMap[model];
  if (!constraints || constraints.length === 0) return;

  const whereFields = new Set(Object.keys(where));

  const valid = constraints.some((constraint) => {
    if (!constraint.every((field) => whereFields.has(field))) return false;
    return constraint.every((field) => {
      const ops = where[field];
      if (!ops) return false;
      return Object.keys(ops).every((op) => op === "equals");
    });
  });

  if (!valid) {
    const constraintDesc = constraints
      .map((c) => `(${c.join(", ")})`)
      .join(" | ");
    throw new ShapeError(
      `${method} on model "${model}" requires where to cover a unique constraint with equality operators only: ${constraintDesc}`,
    );
  }
}

function validateNestedKeys(
  keys: Iterable<string>,
  allowed: Set<string>,
  context: string,
): void {
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new ShapeError(
        `Unknown key "${key}" in ${context}. Allowed: ${[...allowed].join(", ")}`,
      );
    }
  }
}

export function createQueryBuilder(
  typeMap: TypeMap,
  enumMap: EnumMap,
  uniqueMap: UniqueMap = {},
) {
  function isShapeConfig(obj: unknown): obj is ShapeConfig {
    if (!isPlainObject(obj)) return false;
    const keys = Object.keys(obj);
    return keys.length === 0 || keys.every((k) => SHAPE_CONFIG_KEYS.has(k));
  }

  function buildWhereSchema(
    model: string,
    whereConfig: Record<string, Record<string, true | unknown>>,
  ): {
    schema: z.ZodTypeAny | null;
    forced: Record<string, Record<string, unknown>>;
  } {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    const forced: Record<string, Record<string, unknown>> = {};

    for (const [fieldName, operators] of Object.entries(whereConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}"`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in where`,
        );
      if (UNSUPPORTED_WHERE_TYPES.has(fieldMeta.type) && !fieldMeta.isList) {
        throw new ShapeError(
          `${fieldMeta.type} field "${fieldName}" cannot be used in where filters`,
        );
      }

      const opSchemas: Record<string, z.ZodTypeAny> = {};
      const fieldForced: Record<string, unknown> = {};
      let hasClientOps = false;
      let hasStringModeOp = false;
      const clientOpKeys: string[] = [];

      for (const [op, value] of Object.entries(operators)) {
        if (value === true) {
          opSchemas[op] = createOperatorSchema(
            fieldMeta,
            op,
            enumMap,
          ).optional();
          hasClientOps = true;
          clientOpKeys.push(op);
          if (
            fieldMeta.type === "String" &&
            !fieldMeta.isList &&
            STRING_MODE_OPS.has(op)
          ) {
            hasStringModeOp = true;
          }
        } else {
          const opSchema = createOperatorSchema(fieldMeta, op, enumMap);
          let parsed: unknown;
          try {
            parsed = opSchema.parse(value);
          } catch (err: any) {
            throw new ShapeError(
              `Invalid forced value for "${model}.${fieldName}.${op}": ${err.message}`,
            );
          }
          fieldForced[op] = parsed;
        }
      }

      if (!hasClientOps && Object.keys(fieldForced).length === 0) {
        throw new ShapeError(
          `Empty operator config for where field "${fieldName}" on model "${model}". Define at least one operator.`,
        );
      }

      if (hasStringModeOp) {
        opSchemas["mode"] = z.enum(["default", "insensitive"]).optional();
      }

      if (hasClientOps) {
        const opObj = z.object(opSchemas).strict();
        fieldSchemas[fieldName] = opObj
          .refine(
            (v) =>
              clientOpKeys.some(
                (k) => (v as Record<string, unknown>)[k] !== undefined,
              ),
            {
              message: `At least one operator required for where field "${fieldName}"`,
            },
          )
          .optional();
      }

      if (Object.keys(fieldForced).length > 0) {
        forced[fieldName] = fieldForced;
      }
    }

    const schema =
      Object.keys(fieldSchemas).length > 0
        ? z.object(fieldSchemas).strict().optional()
        : null;

    return { schema, forced };
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
    return z.object(fieldSchemas).strict().optional();
  }

  function buildIncludeCountSchema(
    model: string,
    config: true | Record<string, unknown>,
  ): {
    schema: z.ZodTypeAny;
    forcedCountWhere: Record<string, Record<string, unknown>>;
  } {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    if (config === true) {
      return { schema: z.literal(true).optional(), forcedCountWhere: {} };
    }

    if (!isPlainObject(config) || !("select" in config)) {
      throw new ShapeError(
        `Invalid _count config on model "${model}". Expected true or { select: { ... } }`,
      );
    }

    for (const key of Object.keys(config)) {
      if (key !== "select") {
        throw new ShapeError(
          `Unknown key "${key}" in _count config on model "${model}". Only "select" is allowed.`,
        );
      }
    }

    const selectObj = config.select as Record<
      string,
      true | Record<string, unknown>
    >;
    const countSelectFields: Record<string, z.ZodTypeAny> = {};
    const forcedCountWhere: Record<string, Record<string, unknown>> = {};

    for (const [fieldName, fieldConfig] of Object.entries(selectObj)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in _count.select`,
        );
      if (!fieldMeta.isRelation)
        throw new ShapeError(
          `Field "${fieldName}" is not a relation on model "${model}" in _count.select`,
        );

      if (fieldConfig === true) {
        countSelectFields[fieldName] = z.literal(true).optional();
      } else if (isPlainObject(fieldConfig)) {
        validateNestedKeys(
          Object.keys(fieldConfig),
          KNOWN_COUNT_SELECT_ENTRY_KEYS,
          `_count.select.${fieldName} on model "${model}"`,
        );
        if (fieldConfig.where) {
          const relatedType = fieldMeta.type;
          const { schema: whereSchema, forced } = buildWhereSchema(
            relatedType,
            fieldConfig.where as Record<string, Record<string, true | unknown>>,
          );
          const nestedSchemas: Record<string, z.ZodTypeAny> = {};
          if (whereSchema) nestedSchemas["where"] = whereSchema;
          const nestedObj = z.object(nestedSchemas).strict();
          countSelectFields[fieldName] = z
            .union([z.literal(true), nestedObj])
            .optional();

          if (Object.keys(forced).length > 0) {
            forcedCountWhere[fieldName] = forced;
          }
        } else {
          countSelectFields[fieldName] = z.literal(true).optional();
        }
      } else {
        throw new ShapeError(
          `Invalid config for _count.select.${fieldName} on model "${model}". Expected true or { where: { ... } }`,
        );
      }
    }

    const selectSchema = z.object(countSelectFields).strict();
    return {
      schema: z.object({ select: selectSchema }).strict().optional(),
      forcedCountWhere,
    };
  }

  function buildAggregateFieldSchema(
    model: string,
    opName: string,
    fieldConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const isNumericOnly = opName === "_avg" || opName === "_sum";
    const isComparableOnly = opName === "_min" || opName === "_max";

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    for (const fieldName of Object.keys(fieldConfig)) {
      if (fieldName === "_all" && opName === "_count") {
        fieldSchemas[fieldName] = z.literal(true).optional();
        continue;
      }
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in ${opName}`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in ${opName}`,
        );
      if (isNumericOnly && !NUMERIC_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `Field "${fieldName}" (${fieldMeta.type}) cannot be used in ${opName}. Only numeric types (Int, Float, Decimal, BigInt) are supported.`,
        );
      }
      if (isComparableOnly && !COMPARABLE_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `Field "${fieldName}" (${fieldMeta.type}) cannot be used in ${opName}. Only comparable types (Int, Float, Decimal, BigInt, String, DateTime) are supported.`,
        );
      }
      fieldSchemas[fieldName] = z.literal(true).optional();
    }
    return z.object(fieldSchemas).strict().optional();
  }

  function buildBySchema(model: string, byConfig: string[]): z.ZodTypeAny {
    if (byConfig.length === 0) {
      throw new ShapeError('groupBy "by" must contain at least one field');
    }

    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    for (const fieldName of byConfig) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in by`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in by`,
        );
      if (UNSUPPORTED_BY_TYPES.has(fieldMeta.type)) {
        throw new ShapeError(
          `${fieldMeta.type} field "${fieldName}" cannot be used in by`,
        );
      }
      if (fieldMeta.isList) {
        throw new ShapeError(`List field "${fieldName}" cannot be used in by`);
      }
    }
    const enumSchema = z.enum(byConfig as [string, ...string[]]);
    return z.union([enumSchema, z.array(enumSchema).min(1)]);
  }

  function buildCursorSchema(
    model: string,
    cursorConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const cursorFields = new Set(Object.keys(cursorConfig));
    const constraints = uniqueMap[model];
    if (constraints && constraints.length > 0) {
      const covered = constraints.some((constraint) =>
        constraint.every((field) => cursorFields.has(field)),
      );
      if (!covered) {
        const constraintDesc = constraints
          .map((c) => `(${c.join(", ")})`)
          .join(" | ");
        throw new ShapeError(
          `cursor on model "${model}" must cover a unique constraint: ${constraintDesc}`,
        );
      }
    }

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    for (const fieldName of Object.keys(cursorConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}" in cursor`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in cursor`,
        );
      if (fieldMeta.isList)
        throw new ShapeError(
          `List field "${fieldName}" cannot be used in cursor`,
        );
      fieldSchemas[fieldName] = createBaseType(fieldMeta, enumMap);
    }
    return z.object(fieldSchemas).strict().optional();
  }

  function buildDistinctSchema(
    model: string,
    distinctConfig: string[],
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

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
      if (fieldMeta.isList)
        throw new ShapeError(
          `List field "${fieldName}" cannot be used in distinct`,
        );
    }

    const enumSchema = z.enum(distinctConfig as [string, ...string[]]);
    return z.union([enumSchema, z.array(enumSchema).min(1)]).optional();
  }

  function buildIncludeSchema(
    model: string,
    includeConfig: Record<string, true | NestedIncludeArgs>,
  ): BuiltIncludeResult {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    const forcedTree: Record<string, ForcedTree> = {};
    let topLevelForcedCountWhere: Record<string, Record<string, unknown>> = {};

    for (const [relName, config] of Object.entries(includeConfig)) {
      if (relName === "_count") {
        const countResult = buildIncludeCountSchema(
          model,
          config as true | Record<string, unknown>,
        );
        fieldSchemas["_count"] = countResult.schema;
        topLevelForcedCountWhere = countResult.forcedCountWhere;
        continue;
      }

      const fieldMeta = modelFields[relName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${relName}" on model "${model}"`);
      if (!fieldMeta.isRelation)
        throw new ShapeError(
          `Field "${relName}" is not a relation on model "${model}"`,
        );

      if (config === true) {
        fieldSchemas[relName] = z.literal(true).optional();
      } else {
        validateNestedKeys(
          Object.keys(config),
          KNOWN_NESTED_INCLUDE_KEYS,
          `nested include for "${relName}" on model "${model}"`,
        );

        if (config.select && config.include) {
          throw new ShapeError(
            `Nested include for "${relName}" cannot define both "select" and "include".`,
          );
        }

        if (!fieldMeta.isList) {
          if (
            config.where ||
            config.orderBy ||
            config.cursor ||
            config.take ||
            config.skip
          ) {
            throw new ShapeError(
              `Relation "${relName}" on model "${model}" is to-one. Only "include" and "select" are supported for to-one nested reads, not where/orderBy/cursor/take/skip.`,
            );
          }
        }

        const nestedSchemas: Record<string, z.ZodTypeAny> = {};
        const relForced: ForcedTree = {};

        if (config.where) {
          const { schema: whereSchema, forced } = buildWhereSchema(
            fieldMeta.type,
            config.where,
          );
          if (whereSchema) nestedSchemas["where"] = whereSchema;
          if (Object.keys(forced).length > 0) relForced.where = forced;
        }
        if (config.include) {
          const nested = buildIncludeSchema(fieldMeta.type, config.include);
          nestedSchemas["include"] = nested.schema;
          if (Object.keys(nested.forcedTree).length > 0)
            relForced.include = nested.forcedTree;
          if (Object.keys(nested.forcedCountWhere).length > 0)
            relForced._countWhere = nested.forcedCountWhere;
        }
        if (config.select) {
          const nested = buildSelectSchema(fieldMeta.type, config.select);
          nestedSchemas["select"] = nested.schema;
          if (Object.keys(nested.forcedTree).length > 0)
            relForced.select = nested.forcedTree;
          if (Object.keys(nested.forcedCountWhere).length > 0)
            relForced._countWhere = nested.forcedCountWhere;
        }
        if (config.orderBy) {
          nestedSchemas["orderBy"] = buildOrderBySchema(
            fieldMeta.type,
            config.orderBy,
          );
        }
        if (config.cursor) {
          nestedSchemas["cursor"] = buildCursorSchema(
            fieldMeta.type,
            config.cursor,
          );
        }
        if (config.take) {
          nestedSchemas["take"] = buildTakeSchema(config.take);
        }
        if (config.skip) {
          nestedSchemas["skip"] = z.number().int().min(0).optional();
        }

        const nestedObj = z.object(nestedSchemas).strict();
        fieldSchemas[relName] = z
          .union([z.literal(true), nestedObj])
          .optional();

        if (Object.keys(relForced).length > 0) forcedTree[relName] = relForced;
      }
    }

    return {
      schema: z.object(fieldSchemas).strict().optional(),
      forcedTree,
      forcedCountWhere: topLevelForcedCountWhere,
    };
  }

  function buildSelectSchema(
    model: string,
    selectConfig: Record<string, true | NestedSelectArgs>,
  ): BuiltSelectResult {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    const forcedTree: Record<string, ForcedTree> = {};
    let topLevelForcedCountWhere: Record<string, Record<string, unknown>> = {};

    for (const [fieldName, config] of Object.entries(selectConfig)) {
      if (fieldName === "_count") {
        const countResult = buildIncludeCountSchema(
          model,
          config as true | Record<string, unknown>,
        );
        fieldSchemas["_count"] = countResult.schema;
        topLevelForcedCountWhere = countResult.forcedCountWhere;
        continue;
      }

      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}"`,
        );

      if (config === true) {
        fieldSchemas[fieldName] = z.literal(true).optional();
      } else {
        if (!fieldMeta.isRelation) {
          throw new ShapeError(
            `Nested select args only valid for relations, not scalar "${fieldName}"`,
          );
        }

        validateNestedKeys(
          Object.keys(config),
          KNOWN_NESTED_SELECT_KEYS,
          `nested select for "${fieldName}" on model "${model}"`,
        );

        if (!fieldMeta.isList) {
          if (
            config.where ||
            config.orderBy ||
            config.cursor ||
            config.take ||
            config.skip
          ) {
            throw new ShapeError(
              `Relation "${fieldName}" on model "${model}" is to-one. Only "select" is supported for to-one nested reads, not where/orderBy/cursor/take/skip.`,
            );
          }
        }

        const nestedSchemas: Record<string, z.ZodTypeAny> = {};
        const relForced: ForcedTree = {};

        if (config.select) {
          const nested = buildSelectSchema(fieldMeta.type, config.select);
          nestedSchemas["select"] = nested.schema;
          if (Object.keys(nested.forcedTree).length > 0)
            relForced.select = nested.forcedTree;
          if (Object.keys(nested.forcedCountWhere).length > 0)
            relForced._countWhere = nested.forcedCountWhere;
        }
        if (config.where) {
          const { schema: whereSchema, forced } = buildWhereSchema(
            fieldMeta.type,
            config.where,
          );
          if (whereSchema) nestedSchemas["where"] = whereSchema;
          if (Object.keys(forced).length > 0) relForced.where = forced;
        }
        if (config.orderBy) {
          nestedSchemas["orderBy"] = buildOrderBySchema(
            fieldMeta.type,
            config.orderBy,
          );
        }
        if (config.cursor) {
          nestedSchemas["cursor"] = buildCursorSchema(
            fieldMeta.type,
            config.cursor,
          );
        }
        if (config.take) {
          nestedSchemas["take"] = buildTakeSchema(config.take);
        }
        if (config.skip) {
          nestedSchemas["skip"] = z.number().int().min(0).optional();
        }

        const nestedObj = z.object(nestedSchemas).strict();
        fieldSchemas[fieldName] = z
          .union([z.literal(true), nestedObj])
          .optional();

        if (Object.keys(relForced).length > 0)
          forcedTree[fieldName] = relForced;
      }
    }

    return {
      schema: z.object(fieldSchemas).strict().optional(),
      forcedTree,
      forcedCountWhere: topLevelForcedCountWhere,
    };
  }

  function buildOrderBySchema(
    model: string,
    orderByConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};

    for (const fieldName of Object.keys(orderByConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(
          `Unknown field "${fieldName}" on model "${model}"`,
        );
      if (fieldMeta.isRelation)
        throw new ShapeError(
          `Relation field "${fieldName}" cannot be used in orderBy`,
        );
      if (fieldMeta.type === "Json")
        throw new ShapeError(
          `Json field "${fieldName}" cannot be used in orderBy`,
        );
      if (fieldMeta.isList)
        throw new ShapeError(
          `List field "${fieldName}" cannot be used in orderBy`,
        );

      fieldSchemas[fieldName] = z.enum(["asc", "desc"]).optional();
    }

    const singleSchema = z.object(fieldSchemas).strict();
    return z.union([singleSchema, z.array(singleSchema)]).optional();
  }

  function buildTakeSchema(config: {
    max: number;
    default?: number;
  }): z.ZodTypeAny {
    if (!Number.isFinite(config.max) || !Number.isInteger(config.max)) {
      throw new ShapeError(
        `take max must be a finite integer, got ${config.max}`,
      );
    }
    if (config.max < 1) {
      throw new ShapeError(`take max must be at least 1, got ${config.max}`);
    }
    if (config.default !== undefined) {
      if (
        !Number.isFinite(config.default) ||
        !Number.isInteger(config.default)
      ) {
        throw new ShapeError(
          `take default must be a finite integer, got ${config.default}`,
        );
      }
      if (config.default < 1) {
        throw new ShapeError(
          `take default must be at least 1, got ${config.default}`,
        );
      }
      if (config.default > config.max) {
        throw new ShapeError("take default cannot exceed max");
      }
      return z.number().int().min(1).max(config.max).default(config.default);
    }
    return z.number().int().min(1).max(config.max).optional();
  }

  function buildHavingSchema(
    model: string,
    havingConfig: Record<string, true>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

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

      const ops = getSupportedOperators(fieldMeta);
      if (ops.length === 0) {
        throw new ShapeError(
          `${fieldMeta.type} field "${fieldName}" cannot be used in having filters`,
        );
      }

      const opSchemas: Record<string, z.ZodTypeAny> = {};
      const opKeys: string[] = [];
      for (const op of ops) {
        opSchemas[op] = createOperatorSchema(fieldMeta, op, enumMap).optional();
        opKeys.push(op);
      }
      if (fieldMeta.type === "String" && !fieldMeta.isList) {
        opSchemas["mode"] = z.enum(["default", "insensitive"]).optional();
      }
      fieldSchemas[fieldName] = z
        .object(opSchemas)
        .strict()
        .refine(
          (v) =>
            opKeys.some((k) => (v as Record<string, unknown>)[k] !== undefined),
          {
            message: `At least one operator required for having field "${fieldName}"`,
          },
        )
        .optional();
    }
    return z.object(fieldSchemas).strict().optional();
  }

  function buildCountSelectSchema(
    model: string,
    selectConfig: Record<string, true | NestedSelectArgs>,
  ): z.ZodTypeAny {
    const modelFields = typeMap[model];
    if (!modelFields) throw new ShapeError(`Unknown model: ${model}`);

    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    for (const fieldName of Object.keys(selectConfig)) {
      if (fieldName === "_all") {
        fieldSchemas["_all"] = z.literal(true).optional();
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
    return z.object(fieldSchemas).strict().optional();
  }

  function validateShapeArgs(method: QueryMethod, shape: ShapeConfig): void {
    const allowed = METHOD_ALLOWED_ARGS[method];
    for (const key of Object.keys(shape)) {
      if (!SHAPE_CONFIG_KEYS.has(key)) {
        throw new ShapeError(`Unknown shape config key "${key}"`);
      }
      if (!allowed.has(key)) {
        throw new ShapeError(`Arg "${key}" not allowed for method "${method}"`);
      }
    }
    if (UNIQUE_WHERE_METHODS.has(method) && !shape.where) {
      throw new ShapeError(`${method} shape must define "where"`);
    }
    if (shape.include && shape.select) {
      throw new ShapeError(
        'Shape config cannot define both "include" and "select".',
      );
    }
    if (method === "groupBy" && !shape.by) {
      throw new ShapeError('groupBy shape must define "by"');
    }
    if (method === "groupBy" && (shape.include || shape.select)) {
      throw new ShapeError('groupBy does not support "include" or "select"');
    }
    if (method === "aggregate" && (shape.include || shape.select)) {
      throw new ShapeError('aggregate does not support "include" or "select"');
    }
    if (method === "count" && shape.include) {
      throw new ShapeError('count does not support "include"');
    }
    if (method === "groupBy" && shape.orderBy) {
      const bySet = new Set(shape.by);
      for (const fieldName of Object.keys(shape.orderBy)) {
        if (!bySet.has(fieldName)) {
          throw new ShapeError(
            `orderBy field "${fieldName}" must be included in "by" for groupBy`,
          );
        }
      }
    }
    if (method === "groupBy" && shape.having) {
      const bySet = new Set(shape.by);
      for (const fieldName of Object.keys(shape.having)) {
        if (!bySet.has(fieldName)) {
          throw new ShapeError(
            `having field "${fieldName}" must be included in "by" for groupBy`,
          );
        }
      }
    }
  }

  function validateUniqueWhere(
    model: string,
    method: QueryMethod,
    shape: ShapeConfig,
  ): void {
    if (!UNIQUE_WHERE_METHODS.has(method)) return;
    if (!shape.where) return;
    validateUniqueEquality(model, shape.where, method, uniqueMap);
  }

  function buildShapeZodSchema(
    model: string,
    method: QueryMethod,
    shape: ShapeConfig,
  ): BuiltShape {
    validateShapeArgs(method, shape);
    validateUniqueWhere(model, method, shape);

    const schemaFields: Record<string, z.ZodTypeAny> = {};
    let forcedWhere: Record<string, unknown> = {};
    let forcedIncludeTree: Record<string, ForcedTree> = {};
    let forcedSelectTree: Record<string, ForcedTree> = {};
    let forcedIncludeCountWhere: Record<string, Record<string, unknown>> = {};
    let forcedSelectCountWhere: Record<string, Record<string, unknown>> = {};

    if (shape.where) {
      const { schema, forced } = buildWhereSchema(model, shape.where);
      if (schema) schemaFields["where"] = schema;
      forcedWhere = forced;
    }

    if (shape.include) {
      const result = buildIncludeSchema(model, shape.include);
      schemaFields["include"] = result.schema;
      forcedIncludeTree = result.forcedTree;
      forcedIncludeCountWhere = result.forcedCountWhere;
    }

    if (shape.select) {
      if (method === "count") {
        schemaFields["select"] = buildCountSelectSchema(model, shape.select);
      } else {
        const result = buildSelectSchema(model, shape.select);
        schemaFields["select"] = result.schema;
        forcedSelectTree = result.forcedTree;
        forcedSelectCountWhere = result.forcedCountWhere;
      }
    }

    if (shape.orderBy) {
      schemaFields["orderBy"] = buildOrderBySchema(model, shape.orderBy);
    }

    if (shape.cursor) {
      schemaFields["cursor"] = buildCursorSchema(model, shape.cursor);
    }

    if (shape.take) {
      schemaFields["take"] = buildTakeSchema(shape.take);
    }

    if (shape.skip) {
      schemaFields["skip"] = z.number().int().min(0).optional();
    }

    if (shape.distinct) {
      schemaFields["distinct"] = buildDistinctSchema(model, shape.distinct);
    }

    if (shape._count) {
      schemaFields["_count"] = buildCountFieldSchema(
        model,
        shape._count,
        "_count",
      );
    }

    if (shape._avg) {
      schemaFields["_avg"] = buildAggregateFieldSchema(
        model,
        "_avg",
        shape._avg,
      );
    }

    if (shape._sum) {
      schemaFields["_sum"] = buildAggregateFieldSchema(
        model,
        "_sum",
        shape._sum,
      );
    }

    if (shape._min) {
      schemaFields["_min"] = buildAggregateFieldSchema(
        model,
        "_min",
        shape._min,
      );
    }

    if (shape._max) {
      schemaFields["_max"] = buildAggregateFieldSchema(
        model,
        "_max",
        shape._max,
      );
    }

    if (shape.by) {
      schemaFields["by"] = buildBySchema(model, shape.by);
    }

    if (shape.having) {
      schemaFields["having"] = buildHavingSchema(model, shape.having);
    }

    return {
      zodSchema: z.object(schemaFields).strict(),
      forcedWhere,
      forcedIncludeTree,
      forcedSelectTree,
      forcedIncludeCountWhere,
      forcedSelectCountWhere,
    };
  }

  function matchCaller<TCtx>(
    shapes: Record<string, ShapeOrFn<TCtx>>,
    caller: string,
  ): { key: string; shape: ShapeOrFn<TCtx> } | null {
    const matched = matchCallerPattern(Object.keys(shapes), caller);
    if (!matched) return null;
    return { key: matched, shape: shapes[matched] };
  }

  function buildQuerySchema<TCtx>(
    model: string,
    method: QueryMethod,
    config: ShapeOrFn<TCtx> | Record<string, ShapeOrFn<TCtx>>,
  ): QuerySchema<TCtx> {
    const isSingleShape = typeof config === "function" || isShapeConfig(config);
    const builtCache = new Map<string, BuiltShape>();

    if (isSingleShape && typeof config !== "function") {
      const built = buildShapeZodSchema(model, method, config as ShapeConfig);
      builtCache.set("_default", built);
    }

    if (!isSingleShape) {
      for (const key of Object.keys(config as Record<string, unknown>)) {
        if (SHAPE_CONFIG_KEYS.has(key)) {
          throw new ShapeError(
            `Caller key "${key}" collides with reserved shape config key. Rename the caller path.`,
          );
        }
      }

      for (const [key, shapeOrFn] of Object.entries(
        config as Record<string, ShapeOrFn<TCtx>>,
      )) {
        if (typeof shapeOrFn !== "function") {
          const built = buildShapeZodSchema(
            model,
            method,
            shapeOrFn as ShapeConfig,
          );
          builtCache.set(key, built);
        }
      }
    }

    const isUnique = UNIQUE_WHERE_METHODS.has(method);

    return {
      schemas: Object.fromEntries(
        [...builtCache.entries()].map(([k, v]) => [k, v.zodSchema]),
      ),
      parse(body: unknown, opts?: { ctx?: TCtx }): Record<string, unknown> {
        let built: BuiltShape;

        if (isSingleShape) {
          if (typeof config === "function") {
            requireContext(opts?.ctx, "shape function");
            const resolvedShape = config(opts!.ctx!);
            built = buildShapeZodSchema(model, method, resolvedShape);
          } else {
            built = builtCache.get("_default")!;
          }
        } else {
          if (!isPlainObject(body)) {
            throw new ShapeError("Request body must be an object");
          }
          const caller = body.caller;
          if (typeof caller !== "string") {
            throw new CallerError('Missing "caller" field in request body');
          }

          const matched = matchCaller(
            config as Record<string, ShapeOrFn<TCtx>>,
            caller,
          );
          if (!matched) {
            const allowed = Object.keys(
              config as Record<string, ShapeOrFn<TCtx>>,
            );
            throw new CallerError(
              `Unknown caller: "${caller}". Allowed: ${allowed.map((k) => `"${k}"`).join(", ")}`,
            );
          }

          const shapeKey = matched.key;
          const shapeOrFn = matched.shape;

          if (typeof shapeOrFn === "function") {
            requireContext(opts?.ctx, "shape function");
            const resolvedShape = shapeOrFn(opts!.ctx!);
            built = buildShapeZodSchema(model, method, resolvedShape);
          } else {
            built = builtCache.get(shapeKey)!;
          }

          const { caller: _, ...rest } = body;
          body = rest;
        }

        return applyBuiltShape(built, body, isUnique);
      },
    };
  }

  return {
    buildQuerySchema,
    buildShapeZodSchema,
    buildWhereSchema,
    buildIncludeSchema,
    buildSelectSchema,
  };
}