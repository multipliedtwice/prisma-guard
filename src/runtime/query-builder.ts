import { z } from "zod";
import type {
  TypeMap,
  EnumMap,
  UniqueMap,
  QueryMethod,
  ShapeConfig,
  ShapeOrFn,
  QuerySchema,
  OrderByFieldConfig,
} from "../shared/types.js";
import { ShapeError, CallerError } from "../shared/errors.js";
import { SHAPE_CONFIG_KEYS } from "../shared/constants.js";
import {
  resolveGuardVariantKey,
  type GuardVariantResolution,
} from "../shared/guard-variant-routing.js";
import { isPlainObject, coerceToArray } from "../shared/utils.js";
import { requireContext } from "./policy.js";
import { createWhereBuilder } from "./query-builder-where.js";
import { createArgsBuilder } from "./query-builder-args.js";
import { createProjectionBuilder } from "./query-builder-projection.js";
import {
  applyBuiltShape,
  EMPTY_WHERE_FORCED,
  hasWhereForced,
  validateResolvedUniqueWhere,
  validateUniqueEquality,
} from "./query-builder-forced.js";
import type {
  BuiltShape,
  ForcedTree,
  WhereForced,
} from "./query-builder-forced.js";
import type { ScalarBaseMap } from "../shared/scalar-base.js";
import { READ_METHOD_ALLOWED_ARGS } from "../shared/operation-shape-keys.js";
import { strictObjectRequiringOne } from "../shared/zod-helpers.js";

const METHOD_ALLOWED_ARGS: Record<
  QueryMethod,
  Set<string>
> = READ_METHOD_ALLOWED_ARGS as Record<QueryMethod, Set<string>>;

const UNIQUE_WHERE_METHODS: Set<QueryMethod> = new Set([
  "findUnique",
  "findUniqueOrThrow",
]);

export function createQueryBuilder(
  typeMap: TypeMap,
  enumMap: EnumMap,
  uniqueMap: UniqueMap,
  scalarBase: ScalarBaseMap,
) {
  const whereBuilder = createWhereBuilder(
    typeMap,
    enumMap,
    scalarBase,
    uniqueMap,
  );

  const argsBuilder = createArgsBuilder(
    typeMap,
    enumMap,
    uniqueMap,
    scalarBase,
  );

  const projectionBuilder = createProjectionBuilder(typeMap, enumMap, {
    buildWhereSchema: whereBuilder.buildWhereSchema,
    buildOrderBySchema: argsBuilder.buildOrderBySchema,
    buildCursorSchema: argsBuilder.buildCursorSchema,
    buildTakeSchema: argsBuilder.buildTakeSchema,
  });

  function isShapeConfig(obj: unknown): obj is ShapeConfig {
    if (!isPlainObject(obj)) return false;
    const keys = Object.keys(obj);
    return keys.length === 0 || keys.every((k) => SHAPE_CONFIG_KEYS.has(k));
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

    if (
      method === "groupBy" &&
      shape.orderBy &&
      (shape.orderBy as unknown) !== true
    ) {
      const bySet = new Set(shape.by);

      for (const fieldName of Object.keys(shape.orderBy)) {
        if (fieldName === "_count") continue;

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

    validateUniqueEquality(model, shape.where, method, uniqueMap, typeMap);
  }

  function resolveAndValidateShape(
    shapeOrFn: ShapeOrFn<any>,
    ctx?: any,
  ): ShapeConfig {
    if (typeof shapeOrFn === "function") {
      requireContext(ctx, "shape function");

      const result = shapeOrFn(ctx);

      if (!isPlainObject(result)) {
        throw new ShapeError(
          "Dynamic shape function must return a plain object",
        );
      }

      return result as ShapeConfig;
    }

    return shapeOrFn as ShapeConfig;
  }

  function buildGroupByOrderBySchema(
    model: string,
    orderBy: unknown,
    by: string[],
    sortEnum: z.ZodEnum<any>,
  ): z.ZodTypeAny {
    const bySet = new Set(by);

    if ((orderBy as unknown) === true) {
      const groupByOrderFields: Record<string, z.ZodTypeAny> = {};

      for (const field of by) {
        groupByOrderFields[field] = sortEnum.optional();
      }

      groupByOrderFields._count = sortEnum.optional();

      const singleSchema = strictObjectRequiringOne(
        groupByOrderFields,
        "orderBy must specify at least one field",
      );

      return z
        .union([
          singleSchema,
          z.preprocess(coerceToArray, z.array(singleSchema).min(1)),
        ])
        .optional();
    }

    if (!isPlainObject(orderBy)) {
      throw new ShapeError(
        `groupBy orderBy shape on model "${model}" must be true or an object of fields`,
      );
    }

    if (Object.keys(orderBy).length === 0) {
      throw new ShapeError(
        `Empty groupBy orderBy config on model "${model}". Define at least one field.`,
      );
    }

    const groupByOrderFields: Record<string, z.ZodTypeAny> = {};

    for (const [fieldName, config] of Object.entries(orderBy)) {
      if (fieldName === "_count") {
        if (config === true) {
          groupByOrderFields._count = sortEnum.optional();
        } else if (isPlainObject(config)) {
          if (Object.keys(config).length === 0) {
            throw new ShapeError(
              `Empty groupBy orderBy "_count" config on model "${model}". Define at least one by-field.`,
            );
          }

          const countFields: Record<string, z.ZodTypeAny> = {};

          for (const [countField, countConfig] of Object.entries(config)) {
            if (countConfig !== true) {
              throw new ShapeError(
                `groupBy orderBy "_count.${countField}" config on model "${model}" must be true`,
              );
            }

            if (!bySet.has(countField)) {
              throw new ShapeError(
                `orderBy _count field "${countField}" must be included in "by" for groupBy`,
              );
            }

            countFields[countField] = sortEnum.optional();
          }

          groupByOrderFields._count = strictObjectRequiringOne(
            countFields,
            "orderBy._count must specify at least one field",
          ).optional();
        } else {
          throw new ShapeError(
            `groupBy orderBy "_count" config on model "${model}" must be true or an object of by-fields`,
          );
        }

        continue;
      }

      if (config !== true) {
        throw new ShapeError(
          `groupBy orderBy field "${fieldName}" config on model "${model}" must be true`,
        );
      }

      if (!bySet.has(fieldName)) {
        throw new ShapeError(
          `orderBy field "${fieldName}" must be included in "by" for groupBy`,
        );
      }

      groupByOrderFields[fieldName] = sortEnum.optional();
    }

    const singleSchema = strictObjectRequiringOne(
      groupByOrderFields,
      "orderBy must specify at least one field",
    );

    return z
      .union([
        singleSchema,
        z.preprocess(coerceToArray, z.array(singleSchema).min(1)),
      ])
      .optional();
  }

  function buildShapeZodSchema(
    model: string,
    method: QueryMethod,
    shape: ShapeConfig,
  ): BuiltShape {
    validateShapeArgs(method, shape);
    validateUniqueWhere(model, method, shape);

    const schemaFields: Record<string, z.ZodTypeAny> = {};
    let forcedWhere: WhereForced = EMPTY_WHERE_FORCED;
    let forcedOnlyWhereKeys = new Set<string>();
    let forcedIncludeTree: Record<string, ForcedTree> = {};
    let forcedSelectTree: Record<string, ForcedTree> = {};
    let forcedIncludeCountWhere: Record<string, WhereForced> = {};
    let forcedSelectCountWhere: Record<string, WhereForced> = {};

    if (shape.where) {
      if (Object.keys(shape.where).length === 0) {
        throw new ShapeError(
          `Empty "where" in shape for model "${model}" method "${method}". Define at least one field.`,
        );
      }

      const builtWhere = UNIQUE_WHERE_METHODS.has(method)
        ? whereBuilder.buildUniqueWhereSchema(model, shape.where)
        : whereBuilder.buildWhereSchema(model, shape.where);

      if (!builtWhere.schema && !hasWhereForced(builtWhere.forced)) {
        throw new ShapeError(
          `"where" in shape for model "${model}" method "${method}" produced no schema and no forced conditions.`,
        );
      }

      if (builtWhere.schema) {
        schemaFields.where = builtWhere.schema;
      }

      forcedWhere = builtWhere.forced;
      forcedOnlyWhereKeys = builtWhere.forcedOnlyKeys;
    }

    if (shape.include) {
      const result = projectionBuilder.buildIncludeSchema(model, shape.include);
      schemaFields.include = result.schema;
      forcedIncludeTree = result.forcedTree;
      forcedIncludeCountWhere = result.forcedCountWhere;
    }

    if (shape.select) {
      if (method === "count") {
        schemaFields.select = argsBuilder.buildCountSelectSchema(
          model,
          shape.select as Record<string, true>,
        );
      } else {
        const result = projectionBuilder.buildSelectSchema(model, shape.select);
        schemaFields.select = result.schema;
        forcedSelectTree = result.forcedTree;
        forcedSelectCountWhere = result.forcedCountWhere;
      }
    }

    if (shape.orderBy) {
      if (method === "groupBy" && shape.by) {
        const sortEnum = z.enum(["asc", "desc"]);
        schemaFields.orderBy = buildGroupByOrderBySchema(
          model,
          shape.orderBy,
          shape.by,
          sortEnum,
        );
      } else {
        if ((shape.orderBy as unknown) === true) {
          throw new ShapeError(
            `Shape config "orderBy: true" is only supported for groupBy. Define an object of allowed fields.`,
          );
        }

        schemaFields.orderBy = argsBuilder.buildOrderBySchema(
          model,
          shape.orderBy as Record<string, OrderByFieldConfig>,
        );
      }
    }

    if (shape.cursor) {
      schemaFields.cursor = argsBuilder.buildCursorSchema(model, shape.cursor);
    }

    if (shape.take !== undefined) {
      schemaFields.take = argsBuilder.buildTakeSchema(shape.take);
    }

    if (shape.skip !== undefined) {
      if (shape.skip !== true) {
        throw new ShapeError('Shape config "skip" must be true');
      }

      schemaFields.skip = z.number().int().min(0).optional();
    }

    if (shape.distinct) {
      schemaFields.distinct = argsBuilder.buildDistinctSchema(
        model,
        shape.distinct,
      );
    }

    if (shape._count) {
      schemaFields._count = argsBuilder.buildCountFieldSchema(
        model,
        shape._count,
        "_count",
      );
    }

    if (shape._avg) {
      schemaFields._avg = argsBuilder.buildAggregateFieldSchema(
        model,
        "_avg",
        shape._avg,
      );
    }

    if (shape._sum) {
      schemaFields._sum = argsBuilder.buildAggregateFieldSchema(
        model,
        "_sum",
        shape._sum,
      );
    }

    if (shape._min) {
      schemaFields._min = argsBuilder.buildAggregateFieldSchema(
        model,
        "_min",
        shape._min,
      );
    }

    if (shape._max) {
      schemaFields._max = argsBuilder.buildAggregateFieldSchema(
        model,
        "_max",
        shape._max,
      );
    }

    if (shape.by) {
      schemaFields.by = argsBuilder.buildBySchema(model, shape.by);
    }

    if (shape.having) {
      schemaFields.having = argsBuilder.buildHavingSchema(model, shape.having);
    }

    return {
      zodSchema: z.object(schemaFields).strict(),
      forcedWhere,
      forcedOnlyWhereKeys,
      forcedIncludeTree,
      forcedSelectTree,
      forcedIncludeCountWhere,
      forcedSelectCountWhere,
    };
  }

  function throwQueryVariantResolution(
    resolution: Extract<GuardVariantResolution, { ok: false }>,
  ): never {
    const keys = resolution.keys.map((key) => `"${key}"`).join(", ");

    if (resolution.code === "reserved-key") {
      throw new ShapeError(
        `Caller key "${resolution.key}" collides with reserved shape config key. Rename the caller path.`,
      );
    }

    if (resolution.code === "missing-caller") {
      throw new CallerError(
        `Missing caller. This query uses named shape routing with keys: ${keys}. ` +
          `Provide caller via opts.caller.`,
      );
    }

    if (resolution.code === "ambiguous-caller") {
      const matches = (resolution.matches ?? [])
        .map((pattern) => `"${pattern}"`)
        .join(", ");

      throw new CallerError(
        `Ambiguous caller "${resolution.caller}" matches multiple patterns: ${matches}`,
      );
    }

    throw new CallerError(
      `Unknown caller: "${resolution.caller}". Allowed: ${keys}`,
    );
  }

  function buildQuerySchema<TCtx>(
    model: string,
    method: QueryMethod,
    config: ShapeOrFn<TCtx> | Record<string, ShapeOrFn<TCtx>>,
  ): QuerySchema<TCtx> {
    const isSingle = typeof config === "function" || isShapeConfig(config);
    const builtCache = new Map<string, BuiltShape>();

    if (isSingle && typeof config !== "function") {
      builtCache.set(
        "_default",
        buildShapeZodSchema(model, method, config as ShapeConfig),
      );
    }

    if (!isSingle) {
      const keys = Object.keys(config as Record<string, unknown>);
      const validation = resolveGuardVariantKey({
        kind: "named",
        keys,
        caller: undefined,
        reservedKeys: SHAPE_CONFIG_KEYS,
      });

      if (!validation.ok && validation.code === "reserved-key") {
        throwQueryVariantResolution(validation);
      }

      for (const [key, shapeOrFn] of Object.entries(
        config as Record<string, ShapeOrFn<TCtx>>,
      )) {
        if (typeof shapeOrFn !== "function") {
          builtCache.set(
            key,
            buildShapeZodSchema(model, method, shapeOrFn as ShapeConfig),
          );
        }
      }
    }

    const isUnique = UNIQUE_WHERE_METHODS.has(method);

    return {
      schemas: Object.fromEntries(
        [...builtCache.entries()].map(([k, v]) => [k, v.zodSchema]),
      ),
      parse(
        body: unknown,
        opts?: { ctx?: TCtx; caller?: string },
      ): Record<string, unknown> {
        const normalizedBody = body === undefined || body === null ? {} : body;
        let built: BuiltShape;

        if (isSingle) {
          if (typeof config === "function") {
            const resolved = resolveAndValidateShape(config, opts?.ctx);
            built = buildShapeZodSchema(model, method, resolved);
          } else {
            built = builtCache.get("_default")!;
          }
        } else {
          if (!isPlainObject(normalizedBody)) {
            throw new ShapeError("Request body must be an object");
          }

          if ("caller" in (normalizedBody as Record<string, unknown>)) {
            throw new CallerError(
              "Pass caller via opts.caller, not in the request body.",
            );
          }

          const namedConfig = config as Record<string, ShapeOrFn<TCtx>>;
          const resolution = resolveGuardVariantKey({
            kind: "named",
            keys: Object.keys(namedConfig),
            caller: opts?.caller,
            reservedKeys: SHAPE_CONFIG_KEYS,
          });

          if (!resolution.ok) throwQueryVariantResolution(resolution);

          const shapeOrFn = namedConfig[resolution.key];

          if (typeof shapeOrFn === "function") {
            const resolved = resolveAndValidateShape(shapeOrFn, opts?.ctx);
            built = buildShapeZodSchema(model, method, resolved);
          } else {
            built = builtCache.get(resolution.key)!;
          }
        }

        const result = applyBuiltShape(
          built,
          normalizedBody,
          isUnique,
          model,
        );

        if (isUnique && result.where) {
          validateResolvedUniqueWhere(
            model,
            result.where as Record<string, unknown>,
            method,
            uniqueMap,
          );
        }

        return result;
      },
    };
  }

  return {
    buildQuerySchema,
    buildShapeZodSchema,
    buildWhereSchema: whereBuilder.buildWhereSchema,
    buildUniqueWhereSchema: whereBuilder.buildUniqueWhereSchema,
    buildIncludeSchema: projectionBuilder.buildIncludeSchema,
    buildSelectSchema: projectionBuilder.buildSelectSchema,
  };
}
