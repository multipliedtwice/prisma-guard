import { z } from "zod";
import type {
  TypeMap,
  EnumMap,
  ZodChains,
  ZodDefaults,
  UniqueMap,
  ScopeMap,
  GuardShape,
  GuardInput,
  QueryMethod,
  GuardedModel,
  GuardGeneratedConfig,
  NestedIncludeArgs,
  NestedSelectArgs,
} from "../shared/types.js";
import {
  ShapeError,
  formatZodError,
  wrapParseError,
} from "../shared/errors.js";
import {
  GUARD_SHAPE_KEYS,
  toDelegateKey,
  isForcedValue,
} from "../shared/constants.js";
import { createSchemaBuilder } from "./schema-builder.js";
import { createQueryBuilder } from "./query-builder.js";
import {
  applyBuiltShape,
  applyForcedTree,
  applyForcedCountWhere,
  validateUniqueEquality,
  validateResolvedUniqueWhere,
  mergeWhereForced,
  mergeUniqueWhereForced,
  hasWhereForced,
} from "./query-builder-forced.js";
import type {
  BuiltShape,
  ForcedTree,
  WhereForced,
} from "./query-builder-forced.js";
import type {
  WhereBuiltResult,
  UniqueWhereBuiltResult,
} from "./query-builder-where.js";
import {
  buildDataSchema,
  validateCreateCompleteness,
  validateAndMergeData,
  hasDataRefines,
  validateMutationBodyKeys,
  validateMutationShapeKeys,
  ALLOWED_BODY_KEYS_CREATE,
  ALLOWED_BODY_KEYS_CREATE_PROJECTION,
  ALLOWED_BODY_KEYS_CREATE_MANY,
  ALLOWED_BODY_KEYS_CREATE_MANY_PROJECTION,
  ALLOWED_BODY_KEYS_UPDATE,
  ALLOWED_BODY_KEYS_UPDATE_PROJECTION,
  ALLOWED_BODY_KEYS_DELETE,
  ALLOWED_BODY_KEYS_DELETE_PROJECTION,
  ALLOWED_BODY_KEYS_UPSERT,
  VALID_SHAPE_KEYS_CREATE,
  VALID_SHAPE_KEYS_CREATE_PROJECTION,
  VALID_SHAPE_KEYS_UPDATE,
  VALID_SHAPE_KEYS_UPDATE_PROJECTION,
  VALID_SHAPE_KEYS_DELETE,
  VALID_SHAPE_KEYS_DELETE_PROJECTION,
  VALID_SHAPE_KEYS_UPSERT,
} from "./model-guard-data.js";
import type { BuiltDataSchema } from "./model-guard-data.js";
import { resolveShape } from "./model-guard-resolve.js";
import { validateContext } from "./policy.js";
import { isPlainObject } from "../shared/utils.js";
import { createScalarBase } from "../shared/scalar-base.js";

const UNIQUE_MUTATION_METHODS = new Set(["update", "delete", "upsert"]);
const UNIQUE_READ_METHODS = new Set<string>([
  "findUnique",
  "findUniqueOrThrow",
]);

const BULK_MUTATION_METHODS = new Set([
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

const PROJECTION_MUTATION_METHODS = new Set([
  "create",
  "update",
  "upsert",
  "delete",
  "createManyAndReturn",
  "updateManyAndReturn",
]);

const BATCH_CREATE_METHODS = new Set(["createMany", "createManyAndReturn"]);

interface BuiltProjection {
  zodSchema: z.ZodObject<any>;
  forcedIncludeTree: Record<string, ForcedTree>;
  forcedSelectTree: Record<string, ForcedTree>;
  forcedIncludeCountWhere: Record<string, WhereForced>;
  forcedSelectCountWhere: Record<string, WhereForced>;
}

function buildDefaultSelectInput(
  config: Record<string, true | NestedSelectArgs>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "_count") {
      result[key] = buildDefaultCountInput(
        value as true | Record<string, unknown>,
      );
      continue;
    }
    if (value === true) {
      result[key] = true;
    } else {
      const nested: Record<string, unknown> = {};
      if (value.select) nested.select = buildDefaultSelectInput(value.select);
      if (value.include)
        nested.include = buildDefaultIncludeInput(value.include);
      result[key] = Object.keys(nested).length > 0 ? nested : true;
    }
  }
  return result;
}

function buildDefaultIncludeInput(
  config: Record<string, true | NestedIncludeArgs>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "_count") {
      result[key] = buildDefaultCountInput(
        value as true | Record<string, unknown>,
      );
      continue;
    }
    if (value === true) {
      result[key] = true;
    } else {
      const nested: Record<string, unknown> = {};
      if (value.include)
        nested.include = buildDefaultIncludeInput(value.include);
      if (value.select) nested.select = buildDefaultSelectInput(value.select);
      result[key] = Object.keys(nested).length > 0 ? nested : true;
    }
  }
  return result;
}

function buildDefaultCountInput(
  config: true | Record<string, unknown>,
): unknown {
  if (config === true) return true;
  if (!isPlainObject(config) || !config.select || !isPlainObject(config.select))
    return true;
  const selectObj = config.select as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(selectObj)) {
    result[key] = true;
  }
  return { select: result };
}

function buildDefaultProjectionBody(
  shape: GuardShape,
): Record<string, unknown> {
  if (shape.select) {
    return { select: buildDefaultSelectInput(shape.select) };
  }
  if (shape.include) {
    return { include: buildDefaultIncludeInput(shape.include) };
  }
  return {};
}

function applyClientProjectionOverrides(
  shapeDefault: Record<string, unknown>,
  clientProjection: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...shapeDefault };

  for (const [key, clientValue] of Object.entries(clientProjection)) {
    const defaultValue = result[key];

    if (defaultValue === undefined) {
      result[key] = clientValue;
      continue;
    }

    if (clientValue === true) {
      result[key] = true;
      continue;
    }

    if (isPlainObject(clientValue)) {
      if (!isPlainObject(defaultValue)) {
        result[key] = clientValue;
        continue;
      }

      const merged = { ...(defaultValue as Record<string, unknown>) };
      const clientObj = clientValue as Record<string, unknown>;

      for (const [argKey, argValue] of Object.entries(clientObj)) {
        const defaultArgValue = merged[argKey];

        if (
          (argKey === "select" || argKey === "include") &&
          isPlainObject(argValue) &&
          isPlainObject(defaultArgValue)
        ) {
          merged[argKey] = applyClientProjectionOverrides(
            defaultArgValue as Record<string, unknown>,
            argValue as Record<string, unknown>,
          );
        } else {
          merged[argKey] = argValue;
        }
      }

      result[key] = merged;
    }
  }

  return result;
}

function hasClientControlledValues(obj: Record<string, unknown>): boolean {
  for (const value of Object.values(obj)) {
    if (isForcedValue(value)) continue;
    if (value === true) return true;
    if (isPlainObject(value) && hasClientControlledValues(value)) return true;
  }
  return false;
}

function checkIncludeForClientArgs(
  config: Record<string, true | NestedIncludeArgs>,
): boolean {
  for (const [key, value] of Object.entries(config)) {
    if (key === "_count") {
      if (
        value !== true &&
        isPlainObject(value) &&
        isPlainObject((value as Record<string, unknown>).select)
      ) {
        const selectObj = (value as Record<string, unknown>).select as Record<
          string,
          unknown
        >;
        for (const entryVal of Object.values(selectObj)) {
          if (
            isPlainObject(entryVal) &&
            (entryVal as Record<string, unknown>).where
          ) {
            const w = (entryVal as Record<string, unknown>).where;
            if (isPlainObject(w) && hasClientControlledValues(w)) return true;
          }
        }
      }
      continue;
    }
    if (value === true) continue;
    if (value.orderBy || value.cursor || value.take || value.skip) return true;
    if (
      value.where &&
      isPlainObject(value.where) &&
      hasClientControlledValues(value.where as Record<string, unknown>)
    )
      return true;
    if (value.include && checkIncludeForClientArgs(value.include)) return true;
    if (value.select && checkSelectForClientArgs(value.select)) return true;
  }
  return false;
}

function checkSelectForClientArgs(
  config: Record<string, true | NestedSelectArgs>,
): boolean {
  for (const [key, value] of Object.entries(config)) {
    if (key === "_count") {
      if (
        value !== true &&
        isPlainObject(value) &&
        isPlainObject((value as Record<string, unknown>).select)
      ) {
        const selectObj = (value as Record<string, unknown>).select as Record<
          string,
          unknown
        >;
        for (const entryVal of Object.values(selectObj)) {
          if (
            isPlainObject(entryVal) &&
            (entryVal as Record<string, unknown>).where
          ) {
            const w = (entryVal as Record<string, unknown>).where;
            if (isPlainObject(w) && hasClientControlledValues(w)) return true;
          }
        }
      }
      continue;
    }
    if (value === true) continue;
    if (value.orderBy || value.cursor || value.take || value.skip) return true;
    if (
      value.where &&
      isPlainObject(value.where) &&
      hasClientControlledValues(value.where as Record<string, unknown>)
    )
      return true;
    if (value.select && checkSelectForClientArgs(value.select)) return true;
    if (value.include && checkIncludeForClientArgs(value.include)) return true;
  }
  return false;
}

function hasNestedClientControlledArgs(shape: GuardShape): boolean {
  if (shape.include) {
    if (checkIncludeForClientArgs(shape.include)) return true;
  }
  if (shape.select) {
    if (checkSelectForClientArgs(shape.select)) return true;
  }
  return false;
}

export function createModelGuardExtension(config: {
  typeMap: TypeMap;
  enumMap: EnumMap;
  zodChains: ZodChains;
  zodDefaults: ZodDefaults;
  uniqueMap: UniqueMap;
  scopeMap: ScopeMap;
  guardConfig: GuardGeneratedConfig;
  contextFn: () => Record<string, unknown>;
  wrapZodErrors?: boolean;
}) {
  const {
    typeMap,
    enumMap,
    zodChains,
    zodDefaults,
    uniqueMap,
    scopeMap,
    guardConfig,
    contextFn,
  } = config;
  const wrapZodErrors = config.wrapZodErrors ?? false;
  const enforceProjection = guardConfig.enforceProjection ?? false;
  const scalarBase = createScalarBase(guardConfig.strictDecimal ?? false);
  const schemaBuilder = createSchemaBuilder(
    typeMap,
    zodChains,
    enumMap,
    scalarBase,
    zodDefaults,
  );
  const queryBuilder = createQueryBuilder(
    typeMap,
    enumMap,
    uniqueMap,
    scalarBase,
  );

  const modelScopeFks = new Map<string, Set<string>>();
  for (const [model, entries] of Object.entries(scopeMap)) {
    const fks = new Set<string>();
    for (const entry of entries) fks.add(entry.fk);
    modelScopeFks.set(model, fks);
  }

  function maybeValidateUniqueWhere(
    modelName: string,
    shape: GuardShape,
    method: string,
  ): void {
    if (!UNIQUE_MUTATION_METHODS.has(method)) return;
    if (!shape.where) return;
    validateUniqueEquality(modelName, shape.where, method, uniqueMap, typeMap);
  }

  function validateUniqueWhereShapeConfig(
    modelName: string,
    where: Record<string, unknown>,
    method: string,
  ): void {
    const constraints = uniqueMap[modelName];
    if (!constraints || constraints.length === 0) return;

    const equalityFields = new Set<string>();

    for (const [key, value] of Object.entries(where)) {
      if (key === "AND" || key === "OR" || key === "NOT") continue;

      if (value === true) {
        equalityFields.add(key);
        continue;
      }

      if (isPlainObject(value) && "equals" in value) {
        equalityFields.add(key);
        continue;
      }

      if (value !== null && value !== undefined) {
        equalityFields.add(key);
      }
    }

    const valid = constraints.some((constraint) =>
      constraint.every((field) => equalityFields.has(field)),
    );

    if (!valid) {
      const constraintDesc = constraints
        .map((c) => `(${c.join(", ")})`)
        .join(" | ");
      throw new ShapeError(
        `${method} on model "${modelName}" requires where to cover a unique constraint with equality operators only: ${constraintDesc}`,
      );
    }
  }

  function createGuardedMethods(
    modelName: string,
    modelDelegate: Record<string, (args: any) => any>,
    input: GuardInput,
    explicitCaller: string | undefined,
  ) {
    function callDelegate(method: string, args: any): any {
      if (typeof modelDelegate[method] !== "function") {
        throw new ShapeError(
          `Method "${method}" is not available on this model`,
        );
      }
      return modelDelegate[method](args);
    }

    function resolveCaller(): string | undefined {
      if (explicitCaller !== undefined) return explicitCaller;
      const ctx = validateContext(contextFn());
      const c = ctx.caller;
      if (typeof c === "string") return c;
      return undefined;
    }

    const readShapeCache = new Map<string, BuiltShape>();
    const dataSchemaCache = new Map<string, BuiltDataSchema>();
    const whereBuiltCache = new Map<string, WhereBuiltResult>();
    const projectionCache = new Map<string, BuiltProjection>();
    const uniqueWhereCache = new Map<string, UniqueWhereBuiltResult>();

    function getReadShape(
      method: QueryMethod,
      queryShape: Record<string, unknown>,
      matchedKey: string,
      wasDynamic: boolean,
    ): BuiltShape {
      if (!wasDynamic) {
        const cacheKey = `${method}\0${matchedKey}`;
        const cached = readShapeCache.get(cacheKey);
        if (cached) return cached;
        const built = queryBuilder.buildShapeZodSchema(
          modelName,
          method,
          queryShape as any,
        );
        readShapeCache.set(cacheKey, built);
        return built;
      }
      return queryBuilder.buildShapeZodSchema(
        modelName,
        method,
        queryShape as any,
      );
    }

    function getDataSchema(
      mode: "create" | "update",
      dataConfig: Record<string, true | unknown>,
      matchedKey: string,
      wasDynamic: boolean,
    ): BuiltDataSchema {
      if (!wasDynamic && !hasDataRefines(dataConfig)) {
        const cacheKey = `${mode}\0${matchedKey}`;
        const cached = dataSchemaCache.get(cacheKey);
        if (cached) return cached;
        const built = buildDataSchema(
          modelName,
          dataConfig,
          mode,
          typeMap,
          schemaBuilder,
          zodDefaults,
        );
        dataSchemaCache.set(cacheKey, built);
        return built;
      }
      return buildDataSchema(
        modelName,
        dataConfig,
        mode,
        typeMap,
        schemaBuilder,
        zodDefaults,
      );
    }

    function getWhereBuilt(
      whereConfig: Record<string, unknown>,
      matchedKey: string,
      wasDynamic: boolean,
    ): WhereBuiltResult {
      if (!wasDynamic) {
        const cached = whereBuiltCache.get(matchedKey);
        if (cached) return cached;
        const built = queryBuilder.buildWhereSchema(modelName, whereConfig);
        whereBuiltCache.set(matchedKey, built);
        return built;
      }
      return queryBuilder.buildWhereSchema(modelName, whereConfig);
    }

    function getUniqueWhereBuilt(
      whereConfig: Record<string, unknown>,
      matchedKey: string,
      wasDynamic: boolean,
    ): UniqueWhereBuiltResult {
      if (!wasDynamic) {
        const cacheKey = `unique\0${matchedKey}`;
        const cached = uniqueWhereCache.get(cacheKey);
        if (cached) return cached;
        const built = queryBuilder.buildUniqueWhereSchema(
          modelName,
          whereConfig,
        );
        uniqueWhereCache.set(cacheKey, built);
        return built;
      }
      return queryBuilder.buildUniqueWhereSchema(modelName, whereConfig);
    }

    function buildProjectionSchema(shape: GuardShape): BuiltProjection {
      const schemaFields: Record<string, z.ZodTypeAny> = {};
      let forcedIncludeTree: Record<string, ForcedTree> = {};
      let forcedSelectTree: Record<string, ForcedTree> = {};
      let forcedIncludeCountWhere: Record<string, WhereForced> = {};
      let forcedSelectCountWhere: Record<string, WhereForced> = {};

      if (shape.include) {
        const result = queryBuilder.buildIncludeSchema(
          modelName,
          shape.include as Record<string, true | NestedIncludeArgs>,
        );
        schemaFields["include"] = result.schema;
        forcedIncludeTree = result.forcedTree;
        forcedIncludeCountWhere = result.forcedCountWhere;
      }

      if (shape.select) {
        const result = queryBuilder.buildSelectSchema(
          modelName,
          shape.select as Record<string, true | NestedSelectArgs>,
        );
        schemaFields["select"] = result.schema;
        forcedSelectTree = result.forcedTree;
        forcedSelectCountWhere = result.forcedCountWhere;
      }

      return {
        zodSchema: z.object(schemaFields).strict(),
        forcedIncludeTree,
        forcedSelectTree,
        forcedIncludeCountWhere,
        forcedSelectCountWhere,
      };
    }

    function getProjection(
      shape: GuardShape,
      matchedKey: string,
      wasDynamic: boolean,
    ): BuiltProjection {
      if (!wasDynamic) {
        const cacheKey = `projection\0${matchedKey}`;
        const cached = projectionCache.get(cacheKey);
        if (cached) return cached;
        const built = buildProjectionSchema(shape);
        projectionCache.set(cacheKey, built);
        return built;
      }
      return buildProjectionSchema(shape);
    }

    function resolveProjection(
      shape: GuardShape,
      parsed: Record<string, unknown>,
      method: string,
      matchedKey: string,
      wasDynamic: boolean,
    ): Record<string, unknown> {
      const hasBodyProjection = "select" in parsed || "include" in parsed;
      const hasShapeProjection = !!shape.select || !!shape.include;

      if (hasBodyProjection && !hasShapeProjection) {
        throw new ShapeError(
          `Guard shape does not define "select" or "include" for ${method} return projection`,
        );
      }

      if ("select" in parsed && "include" in parsed) {
        throw new ShapeError(
          'Request body cannot define both "select" and "include"',
        );
      }

      if (!hasShapeProjection) return {};

      if (!hasBodyProjection && !enforceProjection) return {};

      if (!hasBodyProjection && enforceProjection) {
        if (hasNestedClientControlledArgs(shape)) {
          throw new ShapeError(
            `Guard shape defines nested client-controlled projection args (orderBy/take/cursor/skip/where) ` +
              `but the client did not provide select/include in the ${method} body. ` +
              `With enforceProjection enabled, either always provide projection in the body ` +
              `or remove client-controlled nested args from the shape.`,
          );
        }
      }

      const projection = getProjection(shape, matchedKey, wasDynamic);

      let projectionBody: Record<string, unknown>;
      if (hasBodyProjection) {
        projectionBody = {};
        if ("select" in parsed) projectionBody.select = parsed.select;
        if ("include" in parsed) projectionBody.include = parsed.include;
      } else {
        projectionBody = buildDefaultProjectionBody(shape);
      }

      let validated: Record<string, unknown>;
      try {
        validated = projection.zodSchema.parse(projectionBody) as Record<
          string,
          unknown
        >;
      } catch (err) {
        wrapParseError(
          err,
          `Invalid select/include projection on model "${modelName}" for ${method}`,
        );
      }

      if (Object.keys(projection.forcedIncludeTree).length > 0) {
        applyForcedTree(validated, "include", projection.forcedIncludeTree);
      }
      if (Object.keys(projection.forcedSelectTree).length > 0) {
        applyForcedTree(validated, "select", projection.forcedSelectTree);
      }
      if (Object.keys(projection.forcedIncludeCountWhere).length > 0) {
        const ic = validated.include as Record<string, unknown> | undefined;
        if (ic) applyForcedCountWhere(ic, projection.forcedIncludeCountWhere);
      }
      if (Object.keys(projection.forcedSelectCountWhere).length > 0) {
        const sc = validated.select as Record<string, unknown> | undefined;
        if (sc) applyForcedCountWhere(sc, projection.forcedSelectCountWhere);
      }

      return validated;
    }

    function buildWhereFromShape(
      shape: GuardShape,
      bodyWhere: unknown,
      preserveUnique: boolean,
      matchedKey: string,
      wasDynamic: boolean,
    ): Record<string, unknown> {
      if (!shape.where) {
        if (bodyWhere !== undefined) {
          throw new ShapeError('Guard shape does not allow "where"');
        }
        return {};
      }

      const built = getWhereBuilt(shape.where, matchedKey, wasDynamic);
      let validatedWhere: Record<string, unknown> | undefined;

      if (built.schema) {
        let sanitizedWhere = bodyWhere;
        if (built.forcedOnlyKeys.size > 0 && isPlainObject(bodyWhere)) {
          const w = { ...(bodyWhere as Record<string, unknown>) };
          for (const key of built.forcedOnlyKeys) {
            delete w[key];
          }
          sanitizedWhere = w;
        }
        try {
          validatedWhere = built.schema.parse(sanitizedWhere) as
            | Record<string, unknown>
            | undefined;
        } catch (err) {
          wrapParseError(err, `Invalid "where" clause on model "${modelName}"`);
        }
      } else if (bodyWhere !== undefined) {
        if (
          bodyWhere === null ||
          !isPlainObject(bodyWhere) ||
          Object.keys(bodyWhere).length > 0
        ) {
          let hasOnlyForcedKeys = false;
          if (isPlainObject(bodyWhere) && built.forcedOnlyKeys.size > 0) {
            hasOnlyForcedKeys = Object.keys(bodyWhere).every((k) =>
              built.forcedOnlyKeys.has(k),
            );
          }
          if (!hasOnlyForcedKeys) {
            throw new ShapeError(
              "Guard shape where contains only forced conditions. Client where input is not accepted.",
            );
          }
        }
      }

      if (hasWhereForced(built.forced)) {
        return preserveUnique
          ? mergeUniqueWhereForced(validatedWhere, built.forced)
          : mergeWhereForced(validatedWhere, built.forced);
      }

      return validatedWhere ?? {};
    }

    function requireWhere(
      shape: GuardShape,
      bodyWhere: unknown,
      method: string,
      preserveUnique: boolean,
      matchedKey: string,
      wasDynamic: boolean,
    ): Record<string, unknown> {
      const where = buildWhereFromShape(
        shape,
        bodyWhere,
        preserveUnique,
        matchedKey,
        wasDynamic,
      );
      if (Object.keys(where).length === 0) {
        const expectedFields = shape.where
          ? Object.keys(shape.where).join(", ")
          : "none defined";
        throw new ShapeError(
          `${method} on model "${modelName}" requires a where condition. Expected fields: ${expectedFields}`,
        );
      }
      return where;
    }

    function buildUniqueWhereFromShape(
      shape: GuardShape,
      bodyWhere: unknown,
      matchedKey: string,
      wasDynamic: boolean,
    ): Record<string, unknown> {
      if (!shape.where) return {};

      const built = getUniqueWhereBuilt(shape.where, matchedKey, wasDynamic);
      let result: Record<string, unknown> = {};

      if (built.schema) {
        if (bodyWhere !== undefined && bodyWhere !== null) {
          if (!isPlainObject(bodyWhere)) {
            throw new ShapeError(
              `Invalid "where" on model "${modelName}": unique where must be a plain object`,
            );
          }
          const sanitized = { ...(bodyWhere as Record<string, unknown>) };
          for (const key of built.forcedOnlyKeys) {
            delete sanitized[key];
          }
          try {
            result = built.schema.parse(sanitized) as Record<string, unknown>;
          } catch (err) {
            const allowedFields = Object.keys(shape.where!).join(", ");
            wrapParseError(
              err,
              `Invalid unique "where" on model "${modelName}". Allowed fields: ${allowedFields}`,
            );
          }
        }
      } else if (bodyWhere !== undefined && bodyWhere !== null) {
        if (isPlainObject(bodyWhere)) {
          const hasOnlyForcedKeys =
            built.forcedOnlyKeys.size > 0 &&
            Object.keys(bodyWhere).every((k) => built.forcedOnlyKeys.has(k));
          if (!hasOnlyForcedKeys && Object.keys(bodyWhere).length > 0) {
            throw new ShapeError(
              `Unique where on model "${modelName}" contains only forced values. Client where input is not accepted.`,
            );
          }
        }
      }

      for (const [key, value] of Object.entries(built.forced)) {
        result[key] = value;
      }

      return result;
    }

    function requireUniqueWhere(
      shape: GuardShape,
      bodyWhere: unknown,
      method: string,
      matchedKey: string,
      wasDynamic: boolean,
    ): Record<string, unknown> {
      const where = buildUniqueWhereFromShape(
        shape,
        bodyWhere,
        matchedKey,
        wasDynamic,
      );
      if (Object.keys(where).length === 0) {
        const constraints = uniqueMap[modelName];
        const constraintDesc = constraints
          ? constraints.map((c) => `(${c.join(", ")})`).join(" | ")
          : "unknown";
        const expectedFields = shape.where
          ? Object.keys(shape.where).join(", ")
          : "none defined";
        throw new ShapeError(
          `${method} on model "${modelName}" requires a unique where condition. ` +
            `Unique constraints: ${constraintDesc}. Shape allows: ${expectedFields}`,
        );
      }
      return where;
    }

    function buildEffectiveReadBody(resolved: {
      body: Record<string, unknown>;
      shape: GuardShape;
    }): Record<string, unknown> {
      const hasShapeProjection =
        !!resolved.shape.select || !!resolved.shape.include;
      if (!hasShapeProjection) return resolved.body;

      const defaultProjection = buildDefaultProjectionBody(resolved.shape);
      const hasBodyProjection =
        "select" in resolved.body || "include" in resolved.body;

      if (!hasBodyProjection) {
        return { ...resolved.body, ...defaultProjection };
      }

      const merged: Record<string, unknown> = { ...resolved.body };

      if (
        "select" in resolved.body &&
        "select" in defaultProjection &&
        isPlainObject(resolved.body.select) &&
        isPlainObject(defaultProjection.select)
      ) {
        merged.select = applyClientProjectionOverrides(
          defaultProjection.select as Record<string, unknown>,
          resolved.body.select as Record<string, unknown>,
        );
      } else if (
        "include" in resolved.body &&
        "include" in defaultProjection &&
        isPlainObject(resolved.body.include) &&
        isPlainObject(defaultProjection.include)
      ) {
        merged.include = applyClientProjectionOverrides(
          defaultProjection.include as Record<string, unknown>,
          resolved.body.include as Record<string, unknown>,
        );
      }

      return merged;
    }

    function makeReadMethod(method: QueryMethod) {
      return (body?: unknown) => {
        const caller = resolveCaller();
        const resolved = resolveShape(input, body, contextFn, caller);
        if (resolved.shape.data) {
          throw new ShapeError(`Guard shape "data" is not valid for ${method}`);
        }
        const { data: _, ...queryShape } = resolved.shape;
        const built = getReadShape(
          method,
          queryShape,
          resolved.matchedKey,
          resolved.wasDynamic,
        );
        const isUnique = UNIQUE_READ_METHODS.has(method);

        const effectiveBody = buildEffectiveReadBody(resolved);

        const args = applyBuiltShape(built, effectiveBody, isUnique, modelName);
        if (isUnique && args.where) {
          validateResolvedUniqueWhere(
            modelName,
            args.where as Record<string, unknown>,
            method,
            uniqueMap,
          );
        }
        return callDelegate(method, args);
      };
    }

    function makeCreateMethod(method: string) {
      const isBatch = BATCH_CREATE_METHODS.has(method);
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method);
      let allowedBodyKeys: Set<string>;
      if (isBatch && supportsProjection) {
        allowedBodyKeys = ALLOWED_BODY_KEYS_CREATE_MANY_PROJECTION;
      } else if (isBatch) {
        allowedBodyKeys = ALLOWED_BODY_KEYS_CREATE_MANY;
      } else if (supportsProjection) {
        allowedBodyKeys = ALLOWED_BODY_KEYS_CREATE_PROJECTION;
      } else {
        allowedBodyKeys = ALLOWED_BODY_KEYS_CREATE;
      }
      const allowedShapeKeys = supportsProjection
        ? VALID_SHAPE_KEYS_CREATE_PROJECTION
        : VALID_SHAPE_KEYS_CREATE;

      return (body: unknown) => {
        const caller = resolveCaller();
        const resolved = resolveShape(input, body, contextFn, caller);
        if (!resolved.shape.data)
          throw new ShapeError(`Guard shape requires "data" for ${method}`);
        validateMutationShapeKeys(
          resolved.shape as unknown as Record<string, unknown>,
          allowedShapeKeys,
          method,
        );
        validateMutationBodyKeys(resolved.body, allowedBodyKeys, method);
        const fks = modelScopeFks.get(modelName) ?? new Set<string>();
        validateCreateCompleteness(
          modelName,
          resolved.shape.data,
          typeMap,
          fks,
          zodDefaults,
        );
        const dataSchema = getDataSchema(
          "create",
          resolved.shape.data,
          resolved.matchedKey,
          resolved.wasDynamic,
        );

        let args: Record<string, unknown>;
        if (method === "create") {
          const data = validateAndMergeData(
            resolved.body.data,
            dataSchema,
            method,
            modelName
          );
          args = { data };
        } else {
          if (!Array.isArray(resolved.body.data))
            throw new ShapeError(`${method} expects data to be an array`);
          if (resolved.body.data.length === 0)
            throw new ShapeError(`${method} received empty data array`);
          const data = resolved.body.data.map((item: unknown) =>
            validateAndMergeData(item, dataSchema, method, modelName),
          );
          args = { data };
        }

        if (isBatch && resolved.body.skipDuplicates !== undefined) {
          if (typeof resolved.body.skipDuplicates !== "boolean") {
            throw new ShapeError(`${method} skipDuplicates must be a boolean`);
          }
          args.skipDuplicates = resolved.body.skipDuplicates;
        }

        if (supportsProjection) {
          const projectionArgs = resolveProjection(
            resolved.shape,
            resolved.body,
            method,
            resolved.matchedKey,
            resolved.wasDynamic,
          );
          Object.assign(args, projectionArgs);
        }

        return callDelegate(method, args);
      };
    }

    function makeUpdateMethod(method: string) {
      const isUniqueWhere = method === "update";
      const isBulk = BULK_MUTATION_METHODS.has(method);
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method);
      const allowedBodyKeys = supportsProjection
        ? ALLOWED_BODY_KEYS_UPDATE_PROJECTION
        : ALLOWED_BODY_KEYS_UPDATE;
      const allowedShapeKeys = supportsProjection
        ? VALID_SHAPE_KEYS_UPDATE_PROJECTION
        : VALID_SHAPE_KEYS_UPDATE;

      return (body: unknown) => {
        const caller = resolveCaller();
        const resolved = resolveShape(input, body, contextFn, caller);
        if (!resolved.shape.data)
          throw new ShapeError(`Guard shape requires "data" for ${method}`);
        validateMutationShapeKeys(
          resolved.shape as unknown as Record<string, unknown>,
          allowedShapeKeys,
          method,
        );
        validateMutationBodyKeys(resolved.body, allowedBodyKeys, method);
        if (isBulk && !resolved.shape.where) {
          throw new ShapeError(
            `Guard shape requires "where" for ${method} to prevent unconstrained bulk mutations`,
          );
        }
        const dataSchema = getDataSchema(
          "update",
          resolved.shape.data,
          resolved.matchedKey,
          resolved.wasDynamic,
        );
        const data = validateAndMergeData(
          resolved.body.data,
          dataSchema,
          method,
          modelName
        );

        let where: Record<string, unknown>;
        if (isUniqueWhere) {
          if (resolved.shape.where) {
            validateUniqueWhereShapeConfig(
              modelName,
              resolved.shape.where,
              method,
            );
          }
          where = requireUniqueWhere(
            resolved.shape,
            resolved.body.where,
            method,
            resolved.matchedKey,
            resolved.wasDynamic,
          );
          validateResolvedUniqueWhere(modelName, where, method, uniqueMap);
        } else {
          maybeValidateUniqueWhere(modelName, resolved.shape, method);
          where = buildWhereFromShape(
            resolved.shape,
            resolved.body.where,
            false,
            resolved.matchedKey,
            resolved.wasDynamic,
          );
          if (isBulk && Object.keys(where).length === 0) {
            throw new ShapeError(
              `${method} requires at least one where condition`,
            );
          }
        }

        const args: Record<string, unknown> = { data, where };

        if (supportsProjection) {
          const projectionArgs = resolveProjection(
            resolved.shape,
            resolved.body,
            method,
            resolved.matchedKey,
            resolved.wasDynamic,
          );
          Object.assign(args, projectionArgs);
        }

        return callDelegate(method, args);
      };
    }

    function makeDeleteMethod(method: string) {
      const isUniqueWhere = method === "delete";
      const isBulk = BULK_MUTATION_METHODS.has(method);
      const supportsProjection = PROJECTION_MUTATION_METHODS.has(method);
      const allowedBodyKeys = supportsProjection
        ? ALLOWED_BODY_KEYS_DELETE_PROJECTION
        : ALLOWED_BODY_KEYS_DELETE;
      const allowedShapeKeys = supportsProjection
        ? VALID_SHAPE_KEYS_DELETE_PROJECTION
        : VALID_SHAPE_KEYS_DELETE;

      return (body: unknown) => {
        const caller = resolveCaller();
        const resolved = resolveShape(input, body, contextFn, caller);
        if (resolved.shape.data)
          throw new ShapeError(`Guard shape "data" is not valid for ${method}`);
        validateMutationShapeKeys(
          resolved.shape as unknown as Record<string, unknown>,
          allowedShapeKeys,
          method,
        );
        validateMutationBodyKeys(resolved.body, allowedBodyKeys, method);
        if (isBulk && !resolved.shape.where) {
          throw new ShapeError(
            `Guard shape requires "where" for ${method} to prevent unconstrained bulk mutations`,
          );
        }

        let where: Record<string, unknown>;
        if (isUniqueWhere) {
          if (resolved.shape.where) {
            validateUniqueWhereShapeConfig(
              modelName,
              resolved.shape.where,
              method,
            );
          }
          where = requireUniqueWhere(
            resolved.shape,
            resolved.body.where,
            method,
            resolved.matchedKey,
            resolved.wasDynamic,
          );
          validateResolvedUniqueWhere(modelName, where, method, uniqueMap);
        } else {
          maybeValidateUniqueWhere(modelName, resolved.shape, method);
          where = buildWhereFromShape(
            resolved.shape,
            resolved.body.where,
            false,
            resolved.matchedKey,
            resolved.wasDynamic,
          );
          if (isBulk && Object.keys(where).length === 0) {
            throw new ShapeError(
              `${method} requires at least one where condition`,
            );
          }
        }

        const args: Record<string, unknown> = { where };

        if (supportsProjection) {
          const projectionArgs = resolveProjection(
            resolved.shape,
            resolved.body,
            method,
            resolved.matchedKey,
            resolved.wasDynamic,
          );
          Object.assign(args, projectionArgs);
        }

        return callDelegate(method, args);
      };
    }

    function makeUpsertMethod() {
      return (body: unknown) => {
        const caller = resolveCaller();
        const resolved = resolveShape(input, body, contextFn, caller);

        if (resolved.shape.data) {
          throw new ShapeError(
            'Guard shape "data" is not valid for upsert. Use "create" and "update" instead.',
          );
        }
        if (!resolved.shape.create) {
          throw new ShapeError('Guard shape requires "create" for upsert');
        }
        if (!resolved.shape.update) {
          throw new ShapeError('Guard shape requires "update" for upsert');
        }
        if (!resolved.shape.where) {
          throw new ShapeError('Guard shape requires "where" for upsert');
        }

        validateMutationShapeKeys(
          resolved.shape as unknown as Record<string, unknown>,
          VALID_SHAPE_KEYS_UPSERT,
          "upsert",
        );
        validateMutationBodyKeys(
          resolved.body,
          ALLOWED_BODY_KEYS_UPSERT,
          "upsert",
        );

        validateUniqueWhereShapeConfig(
          modelName,
          resolved.shape.where,
          "upsert",
        );

        const fks = modelScopeFks.get(modelName) ?? new Set<string>();
        validateCreateCompleteness(
          modelName,
          resolved.shape.create,
          typeMap,
          fks,
          zodDefaults,
        );

        const createDataSchema = getDataSchema(
          "create",
          resolved.shape.create,
          `upsert:create\0${resolved.matchedKey}`,
          resolved.wasDynamic,
        );
        const createData = validateAndMergeData(
          resolved.body.create,
          createDataSchema,
          "upsert (create)",
          modelName
        );

        const updateDataSchema = getDataSchema(
          "update",
          resolved.shape.update,
          `upsert:update\0${resolved.matchedKey}`,
          resolved.wasDynamic,
        );
        const updateData = validateAndMergeData(
          resolved.body.update,
          updateDataSchema,
          "upsert (update)",
          modelName
        );

        const where = requireUniqueWhere(
          resolved.shape,
          resolved.body.where,
          "upsert",
          resolved.matchedKey,
          resolved.wasDynamic,
        );
        validateResolvedUniqueWhere(modelName, where, "upsert", uniqueMap);

        const args: Record<string, unknown> = {
          where,
          create: createData,
          update: updateData,
        };

        const projectionArgs = resolveProjection(
          resolved.shape,
          resolved.body,
          "upsert",
          resolved.matchedKey,
          resolved.wasDynamic,
        );
        Object.assign(args, projectionArgs);

        return callDelegate("upsert", args);
      };
    }

    return {
      findMany: makeReadMethod("findMany"),
      findFirst: makeReadMethod("findFirst"),
      findFirstOrThrow: makeReadMethod("findFirstOrThrow"),
      findUnique: makeReadMethod("findUnique"),
      findUniqueOrThrow: makeReadMethod("findUniqueOrThrow"),
      count: makeReadMethod("count"),
      aggregate: makeReadMethod("aggregate"),
      groupBy: makeReadMethod("groupBy"),
      create: makeCreateMethod("create"),
      createMany: makeCreateMethod("createMany"),
      createManyAndReturn: makeCreateMethod("createManyAndReturn"),
      update: makeUpdateMethod("update"),
      updateMany: makeUpdateMethod("updateMany"),
      updateManyAndReturn: makeUpdateMethod("updateManyAndReturn"),
      upsert: makeUpsertMethod(),
      delete: makeDeleteMethod("delete"),
      deleteMany: makeDeleteMethod("deleteMany"),
    };
  }

  function wrapMethods(
    methods: Record<string, (body?: unknown) => any>,
  ): Record<string, (body?: unknown) => any> {
    const wrapped: Record<string, (body?: unknown) => any> = {};
    for (const [key, fn] of Object.entries(methods)) {
      wrapped[key] = (body?: unknown) => {
        try {
          return fn(body);
        } catch (err) {
          if (err instanceof z.ZodError) {
            throw new ShapeError(`Validation failed: ${formatZodError(err)}`, {
              cause: err,
            });
          }
          throw err;
        }
      };
    }
    return wrapped;
  }

  return {
    $allModels: {
      guard(this: any, input: GuardInput, caller?: string) {
        const modelName: string = this.$name;
        const delegateKey = toDelegateKey(modelName);
        const modelDelegate = this.$parent[delegateKey];
        if (!modelDelegate) {
          throw new ShapeError(
            `Could not resolve Prisma delegate for model "${modelName}" (key: "${delegateKey}")`,
          );
        }
        const methods = createGuardedMethods(
          modelName,
          modelDelegate,
          input,
          caller,
        );
        if (!wrapZodErrors) return methods;
        return wrapMethods(methods);
      },
    },
  };
}
