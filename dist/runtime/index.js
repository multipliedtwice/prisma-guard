// src/runtime/schema-builder.ts
import { z as z2 } from "zod";

// src/shared/errors.ts
var PolicyError = class extends Error {
  status = 403;
  code = "POLICY_DENIED";
  constructor(message = "Access denied", options) {
    super(message, options);
    this.name = "PolicyError";
  }
};
var ShapeError = class extends Error {
  status = 400;
  code = "SHAPE_INVALID";
  constructor(message, options) {
    super(message, options);
    this.name = "ShapeError";
  }
};
var CallerError = class extends Error {
  status = 400;
  code = "CALLER_UNKNOWN";
  constructor(caller, options) {
    super(`Unknown caller: ${caller}`, options);
    this.name = "CallerError";
  }
};

// src/runtime/zod-type-map.ts
import { z } from "zod";
var SCALAR_BASE = {
  String: () => z.string(),
  Int: () => z.number().int(),
  Float: () => z.number(),
  Decimal: () => z.union([
    z.number(),
    z.string().regex(/^-?\d+(\.\d+)?$/),
    z.custom((v) => typeof v === "object" && v !== null && typeof v.toFixed === "function")
  ]),
  BigInt: () => z.bigint(),
  Boolean: () => z.boolean(),
  DateTime: () => z.coerce.date(),
  Json: () => z.unknown(),
  Bytes: () => z.union([
    z.string(),
    z.custom((v) => v instanceof Uint8Array)
  ])
};
var SCALAR_OPERATORS = {
  String: /* @__PURE__ */ new Set(["equals", "not", "contains", "startsWith", "endsWith", "in", "notIn"]),
  Int: /* @__PURE__ */ new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  Float: /* @__PURE__ */ new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  Decimal: /* @__PURE__ */ new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  BigInt: /* @__PURE__ */ new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"]),
  Boolean: /* @__PURE__ */ new Set(["equals", "not"]),
  DateTime: /* @__PURE__ */ new Set(["equals", "not", "gt", "gte", "lt", "lte", "in", "notIn"])
};
var ENUM_OPERATORS = /* @__PURE__ */ new Set(["equals", "not", "in", "notIn"]);
function createBaseType(fieldMeta, enumMap) {
  let base;
  if (fieldMeta.isEnum) {
    const values = enumMap[fieldMeta.type];
    if (!values || values.length === 0) {
      throw new ShapeError(`Unknown enum: ${fieldMeta.type}`);
    }
    base = z.enum(values);
  } else {
    const factory = SCALAR_BASE[fieldMeta.type];
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
function createOperatorSchema(fieldMeta, operator, enumMap) {
  if (fieldMeta.isEnum) {
    const values = enumMap[fieldMeta.type];
    if (!values || values.length === 0) {
      throw new ShapeError(`Unknown enum: ${fieldMeta.type}`);
    }
    if (!ENUM_OPERATORS.has(operator)) {
      throw new ShapeError(`Operator "${operator}" not supported for enum fields`);
    }
    const enumSchema = z.enum(values);
    if (operator === "equals" || operator === "not") {
      return !fieldMeta.isRequired ? z.union([enumSchema, z.null()]) : enumSchema;
    }
    if (!fieldMeta.isRequired) {
      return z.array(z.union([enumSchema, z.null()]));
    }
    return z.array(enumSchema);
  }
  const supportedOps = SCALAR_OPERATORS[fieldMeta.type];
  if (!supportedOps) {
    throw new ShapeError(`Unknown scalar type for operator: ${fieldMeta.type}`);
  }
  if (!supportedOps.has(operator)) {
    throw new ShapeError(`Operator "${operator}" not supported for type "${fieldMeta.type}"`);
  }
  const factory = SCALAR_BASE[fieldMeta.type];
  if (!factory) {
    throw new ShapeError(`Unknown scalar type: ${fieldMeta.type}`);
  }
  const scalar = factory();
  if (operator === "equals" || operator === "not") {
    return !fieldMeta.isRequired ? z.union([scalar, z.null()]) : scalar;
  }
  if (operator === "in" || operator === "notIn") {
    if (!fieldMeta.isRequired) {
      return z.array(z.union([scalar, z.null()]));
    }
    return z.array(scalar);
  }
  return scalar;
}

// src/runtime/schema-builder.ts
var DEFAULT_MAX_CACHE = 500;
var DEFAULT_MAX_DEPTH = 5;
function lruGet(cache, key) {
  const value = cache.get(key);
  if (value !== void 0) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}
function lruSet(cache, key, value, maxSize) {
  if (cache.has(key))
    cache.delete(key);
  cache.set(key, value);
  if (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    if (oldest !== void 0)
      cache.delete(oldest);
  }
}
function createSchemaBuilder(typeMap, zodChains, enumMap) {
  const chainCache = /* @__PURE__ */ new Map();
  function buildFieldSchema(model, field) {
    const cacheKey = `${model}.${field}`;
    const cached = lruGet(chainCache, cacheKey);
    if (cached)
      return cached;
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const fieldMeta = modelFields[field];
    if (!fieldMeta)
      throw new ShapeError(`Unknown field "${field}" on model "${model}"`);
    const base = createBaseType(fieldMeta, enumMap);
    let result = base;
    const chainFn = zodChains[model]?.[field];
    if (chainFn) {
      try {
        result = chainFn(base);
      } catch (err) {
        throw new ShapeError(
          `Invalid @zod directive on ${model}.${field} (${fieldMeta.type}): ${err.message}`,
          { cause: err }
        );
      }
    }
    lruSet(chainCache, cacheKey, result, DEFAULT_MAX_CACHE);
    return result;
  }
  function buildInputSchema(model, opts) {
    const mode = opts.mode ?? "create";
    const allowNull = opts.allowNull ?? false;
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    let fieldNames = Object.keys(modelFields).filter((name) => {
      const meta = modelFields[name];
      return !meta.isRelation && !meta.isUpdatedAt;
    });
    if (opts.pick) {
      for (const name of opts.pick) {
        if (!modelFields[name])
          throw new ShapeError(`Unknown field "${name}" on model "${model}"`);
        if (modelFields[name].isRelation)
          throw new ShapeError(`Field "${name}" cannot be used in input schema (relation field)`);
        if (modelFields[name].isUpdatedAt)
          throw new ShapeError(`Field "${name}" cannot be used in input schema (updatedAt field)`);
      }
      fieldNames = fieldNames.filter((n) => opts.pick.includes(n));
    } else if (opts.omit) {
      for (const name of opts.omit) {
        if (!modelFields[name])
          throw new ShapeError(`Unknown field "${name}" on model "${model}"`);
      }
      fieldNames = fieldNames.filter((n) => !opts.omit.includes(n));
    }
    const schemaMap = {};
    for (const name of fieldNames) {
      const fieldMeta = modelFields[name];
      let fieldSchema;
      if (opts.refine?.[name]) {
        const freshBase = createBaseType(fieldMeta, enumMap);
        fieldSchema = opts.refine[name](freshBase);
      } else {
        fieldSchema = buildFieldSchema(model, name);
      }
      if (mode === "create") {
        if (!fieldMeta.isRequired) {
          fieldSchema = allowNull ? fieldSchema.nullable().optional() : fieldSchema.optional();
        } else if (fieldMeta.hasDefault) {
          fieldSchema = fieldSchema.optional();
        }
      } else {
        if (!fieldMeta.isRequired && allowNull) {
          fieldSchema = fieldSchema.nullable().optional();
        } else {
          fieldSchema = fieldSchema.optional();
        }
      }
      schemaMap[name] = fieldSchema;
    }
    let schema = z2.object(schemaMap).strict();
    if (opts.partial) {
      schema = schema.partial();
    }
    return {
      schema,
      parse(data) {
        return schema.parse(data);
      }
    };
  }
  function buildModelSchema(model, opts, depth = 0, maxDepth) {
    const effectiveMaxDepth = maxDepth ?? opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    if (depth > effectiveMaxDepth) {
      throw new ShapeError(`Maximum include depth (${effectiveMaxDepth}) exceeded`);
    }
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const includeKeys = new Set(Object.keys(opts.include ?? {}));
    if (opts.pick) {
      for (const name of opts.pick) {
        if (!modelFields[name])
          throw new ShapeError(`Unknown field "${name}" on model "${model}"`);
        if (modelFields[name].isRelation && !includeKeys.has(name)) {
          throw new ShapeError(`Field "${name}" is a relation on model "${model}". Use include: { ${name}: ... } instead of pick.`);
        }
      }
    }
    if (opts.omit) {
      for (const name of opts.omit) {
        if (!modelFields[name])
          throw new ShapeError(`Unknown field "${name}" on model "${model}"`);
      }
    }
    let scalarNames = Object.keys(modelFields).filter((name) => {
      const meta = modelFields[name];
      return !meta.isRelation;
    });
    if (opts.pick) {
      scalarNames = scalarNames.filter((n) => opts.pick.includes(n));
    } else if (opts.omit) {
      scalarNames = scalarNames.filter((n) => !opts.omit.includes(n));
    }
    const schemaMap = {};
    for (const name of scalarNames) {
      const fieldMeta = modelFields[name];
      let fieldSchema = createBaseType(fieldMeta, enumMap);
      if (!fieldMeta.isRequired) {
        fieldSchema = fieldSchema.nullable();
      }
      schemaMap[name] = fieldSchema;
    }
    for (const [relName, relOpts] of Object.entries(opts.include ?? {})) {
      const fieldMeta = modelFields[relName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${relName}" on model "${model}"`);
      if (!fieldMeta.isRelation)
        throw new ShapeError(`Field "${relName}" is not a relation on model "${model}"`);
      const relatedModel = fieldMeta.type;
      if (!typeMap[relatedModel]) {
        throw new ShapeError(`Related model "${relatedModel}" not found in type map`);
      }
      let relSchema = buildModelSchema(relatedModel, relOpts, depth + 1, effectiveMaxDepth);
      if (fieldMeta.isList) {
        relSchema = z2.array(relSchema);
      } else if (!fieldMeta.isRequired) {
        relSchema = relSchema.nullable();
      }
      schemaMap[relName] = relSchema;
    }
    if (opts._count) {
      const relationNames = Object.keys(modelFields).filter((n) => modelFields[n].isRelation);
      if (opts._count === true) {
        const countFields = {};
        for (const relName of relationNames) {
          countFields[relName] = z2.number().int().min(0);
        }
        schemaMap["_count"] = z2.object(countFields);
      } else {
        const countFields = {};
        for (const relName of Object.keys(opts._count)) {
          if (!modelFields[relName])
            throw new ShapeError(`Unknown field "${relName}" on model "${model}" in _count`);
          if (!modelFields[relName].isRelation)
            throw new ShapeError(`Field "${relName}" is not a relation on model "${model}" in _count`);
          countFields[relName] = z2.number().int().min(0);
        }
        schemaMap["_count"] = z2.object(countFields);
      }
    }
    let schema = z2.object(schemaMap);
    if (opts.strict) {
      schema = schema.strict();
    }
    return schema;
  }
  return { buildFieldSchema, buildInputSchema, buildModelSchema };
}

// src/runtime/query-builder.ts
import { z as z3 } from "zod";

// src/runtime/policy.ts
function requireContext(ctx, label) {
  if (ctx === void 0 || ctx === null) {
    throw new PolicyError(`Context required for ${label}`);
  }
}

// src/runtime/query-builder.ts
var METHOD_ALLOWED_ARGS = {
  findMany: /* @__PURE__ */ new Set(["where", "include", "select", "orderBy", "cursor", "take", "skip", "distinct"]),
  findFirst: /* @__PURE__ */ new Set(["where", "include", "select", "orderBy", "cursor", "take", "skip", "distinct"]),
  findFirstOrThrow: /* @__PURE__ */ new Set(["where", "include", "select", "orderBy", "cursor", "take", "skip", "distinct"]),
  findUnique: /* @__PURE__ */ new Set(["where", "include", "select"]),
  findUniqueOrThrow: /* @__PURE__ */ new Set(["where", "include", "select"]),
  count: /* @__PURE__ */ new Set(["where"]),
  aggregate: /* @__PURE__ */ new Set(["where", "_count", "_avg", "_sum", "_min", "_max"]),
  groupBy: /* @__PURE__ */ new Set(["where", "by", "_count", "_avg", "_sum", "_min", "_max", "orderBy", "take", "skip"])
};
var SHAPE_CONFIG_KEYS = /* @__PURE__ */ new Set([
  "where",
  "include",
  "select",
  "orderBy",
  "cursor",
  "take",
  "skip",
  "distinct",
  "_count",
  "_avg",
  "_sum",
  "_min",
  "_max",
  "by"
]);
var STRING_MODE_OPS = /* @__PURE__ */ new Set(["contains", "startsWith", "endsWith", "equals"]);
var RESERVED_CALLER_KEYS = SHAPE_CONFIG_KEYS;
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function createQueryBuilder(typeMap, enumMap) {
  function isShapeConfig(obj) {
    if (!isPlainObject(obj))
      return false;
    const keys = Object.keys(obj);
    return keys.length === 0 || keys.every((k) => SHAPE_CONFIG_KEYS.has(k));
  }
  function buildWhereSchema(model, whereConfig) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const fieldSchemas = {};
    const forced = {};
    for (const [fieldName, operators] of Object.entries(whereConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`);
      if (fieldMeta.isRelation)
        throw new ShapeError(`Relation field "${fieldName}" cannot be used in where`);
      if (fieldMeta.type === "Json")
        throw new ShapeError(`Json field "${fieldName}" cannot be used in where`);
      const opSchemas = {};
      const fieldForced = {};
      let hasClientOps = false;
      let hasStringModeOp = false;
      for (const [op, value] of Object.entries(operators)) {
        if (value === true) {
          opSchemas[op] = createOperatorSchema(fieldMeta, op, enumMap).optional();
          hasClientOps = true;
          if (fieldMeta.type === "String" && STRING_MODE_OPS.has(op)) {
            hasStringModeOp = true;
          }
        } else {
          fieldForced[op] = value;
        }
      }
      if (hasStringModeOp) {
        opSchemas["mode"] = z3.enum(["default", "insensitive"]).optional();
      }
      if (hasClientOps) {
        fieldSchemas[fieldName] = z3.object(opSchemas).strict().optional();
      }
      if (Object.keys(fieldForced).length > 0) {
        forced[fieldName] = fieldForced;
      }
    }
    const schema = Object.keys(fieldSchemas).length > 0 ? z3.object(fieldSchemas).strict().optional() : null;
    return { schema, forced };
  }
  function buildCountFieldSchema(model, config, context) {
    if (config === true) {
      return z3.literal(true).optional();
    }
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const fieldSchemas = {};
    for (const fieldName of Object.keys(config)) {
      if (fieldName !== "_all") {
        const fieldMeta = modelFields[fieldName];
        if (!fieldMeta)
          throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in ${context}`);
      }
      fieldSchemas[fieldName] = z3.literal(true).optional();
    }
    return z3.object(fieldSchemas).strict().optional();
  }
  function buildIncludeCountSchema(model, config) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    if (config === true) {
      return z3.literal(true).optional();
    }
    if (!isPlainObject(config) || !("select" in config)) {
      throw new ShapeError(`Invalid _count config on model "${model}". Expected true or { select: { ... } }`);
    }
    const selectObj = config.select;
    const countSelectFields = {};
    for (const fieldName of Object.keys(selectObj)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in _count.select`);
      if (!fieldMeta.isRelation)
        throw new ShapeError(`Field "${fieldName}" is not a relation on model "${model}" in _count.select`);
      countSelectFields[fieldName] = z3.literal(true).optional();
    }
    const selectSchema = z3.object(countSelectFields).strict();
    return z3.object({ select: selectSchema }).strict().optional();
  }
  function buildAggregateFieldSchema(model, opName, fieldConfig) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const fieldSchemas = {};
    for (const fieldName of Object.keys(fieldConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in ${opName}`);
      if (fieldMeta.isRelation)
        throw new ShapeError(`Relation field "${fieldName}" cannot be used in ${opName}`);
      fieldSchemas[fieldName] = z3.literal(true).optional();
    }
    return z3.object(fieldSchemas).strict().optional();
  }
  function buildBySchema(model, byConfig) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    for (const fieldName of byConfig) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in by`);
      if (fieldMeta.isRelation)
        throw new ShapeError(`Relation field "${fieldName}" cannot be used in by`);
    }
    return z3.array(z3.enum(byConfig)).min(1);
  }
  function buildCursorSchema(model, cursorConfig) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const fieldSchemas = {};
    for (const fieldName of Object.keys(cursorConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in cursor`);
      if (fieldMeta.isRelation)
        throw new ShapeError(`Relation field "${fieldName}" cannot be used in cursor`);
      fieldSchemas[fieldName] = createBaseType(fieldMeta, enumMap);
    }
    return z3.object(fieldSchemas).strict().optional();
  }
  function buildDistinctSchema(model, distinctConfig) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    for (const fieldName of distinctConfig) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${fieldName}" on model "${model}" in distinct`);
      if (fieldMeta.isRelation)
        throw new ShapeError(`Relation field "${fieldName}" cannot be used in distinct`);
    }
    const enumSchema = z3.enum(distinctConfig);
    return z3.union([enumSchema, z3.array(enumSchema).min(1)]).optional();
  }
  function buildIncludeSchema(model, includeConfig) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const fieldSchemas = {};
    const forcedTree = {};
    for (const [relName, config] of Object.entries(includeConfig)) {
      if (relName === "_count") {
        fieldSchemas["_count"] = buildIncludeCountSchema(model, config);
        continue;
      }
      const fieldMeta = modelFields[relName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${relName}" on model "${model}"`);
      if (!fieldMeta.isRelation)
        throw new ShapeError(`Field "${relName}" is not a relation on model "${model}"`);
      if (config === true) {
        fieldSchemas[relName] = z3.literal(true).optional();
      } else {
        if (config.select && config.include) {
          throw new ShapeError(
            `Nested include for "${relName}" cannot define both "select" and "include".`
          );
        }
        const nestedSchemas = {};
        const relForced = {};
        if (config.where) {
          const { schema: whereSchema, forced } = buildWhereSchema(fieldMeta.type, config.where);
          if (whereSchema)
            nestedSchemas["where"] = whereSchema;
          if (Object.keys(forced).length > 0)
            relForced.where = forced;
        }
        if (config.include) {
          const nested = buildIncludeSchema(fieldMeta.type, config.include);
          nestedSchemas["include"] = nested.schema;
          if (Object.keys(nested.forcedTree).length > 0)
            relForced.include = nested.forcedTree;
        }
        if (config.select) {
          const nested = buildSelectSchema(fieldMeta.type, config.select);
          nestedSchemas["select"] = nested.schema;
          if (Object.keys(nested.forcedTree).length > 0)
            relForced.select = nested.forcedTree;
        }
        if (config.orderBy) {
          nestedSchemas["orderBy"] = buildOrderBySchema(fieldMeta.type, config.orderBy);
        }
        if (config.cursor) {
          nestedSchemas["cursor"] = buildCursorSchema(fieldMeta.type, config.cursor);
        }
        if (config.take) {
          nestedSchemas["take"] = buildTakeSchema(config.take);
        }
        if (config.skip) {
          nestedSchemas["skip"] = z3.number().int().min(0).optional();
        }
        const nestedObj = z3.object(nestedSchemas).strict();
        fieldSchemas[relName] = z3.union([z3.literal(true), nestedObj]).optional();
        if (Object.keys(relForced).length > 0)
          forcedTree[relName] = relForced;
      }
    }
    return {
      schema: z3.object(fieldSchemas).strict().optional(),
      forcedTree
    };
  }
  function buildSelectSchema(model, selectConfig) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const fieldSchemas = {};
    const forcedTree = {};
    for (const [fieldName, config] of Object.entries(selectConfig)) {
      if (fieldName === "_count") {
        fieldSchemas["_count"] = buildIncludeCountSchema(model, config);
        continue;
      }
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`);
      if (config === true) {
        fieldSchemas[fieldName] = z3.literal(true).optional();
      } else {
        if (!fieldMeta.isRelation) {
          throw new ShapeError(`Nested select args only valid for relations, not scalar "${fieldName}"`);
        }
        const nestedSchemas = {};
        const relForced = {};
        if (config.select) {
          const nested = buildSelectSchema(fieldMeta.type, config.select);
          nestedSchemas["select"] = nested.schema;
          if (Object.keys(nested.forcedTree).length > 0)
            relForced.select = nested.forcedTree;
        }
        if (config.where) {
          const { schema: whereSchema, forced } = buildWhereSchema(fieldMeta.type, config.where);
          if (whereSchema)
            nestedSchemas["where"] = whereSchema;
          if (Object.keys(forced).length > 0)
            relForced.where = forced;
        }
        if (config.orderBy) {
          nestedSchemas["orderBy"] = buildOrderBySchema(fieldMeta.type, config.orderBy);
        }
        if (config.cursor) {
          nestedSchemas["cursor"] = buildCursorSchema(fieldMeta.type, config.cursor);
        }
        if (config.take) {
          nestedSchemas["take"] = buildTakeSchema(config.take);
        }
        if (config.skip) {
          nestedSchemas["skip"] = z3.number().int().min(0).optional();
        }
        const nestedObj = z3.object(nestedSchemas).strict();
        fieldSchemas[fieldName] = z3.union([z3.literal(true), nestedObj]).optional();
        if (Object.keys(relForced).length > 0)
          forcedTree[fieldName] = relForced;
      }
    }
    return {
      schema: z3.object(fieldSchemas).strict().optional(),
      forcedTree
    };
  }
  function buildOrderBySchema(model, orderByConfig) {
    const modelFields = typeMap[model];
    if (!modelFields)
      throw new ShapeError(`Unknown model: ${model}`);
    const fieldSchemas = {};
    for (const fieldName of Object.keys(orderByConfig)) {
      const fieldMeta = modelFields[fieldName];
      if (!fieldMeta)
        throw new ShapeError(`Unknown field "${fieldName}" on model "${model}"`);
      if (fieldMeta.isRelation)
        throw new ShapeError(`Relation field "${fieldName}" cannot be used in orderBy`);
      if (fieldMeta.type === "Json")
        throw new ShapeError(`Json field "${fieldName}" cannot be used in orderBy`);
      fieldSchemas[fieldName] = z3.enum(["asc", "desc"]).optional();
    }
    const singleSchema = z3.object(fieldSchemas).strict();
    return z3.union([singleSchema, z3.array(singleSchema)]).optional();
  }
  function buildTakeSchema(config) {
    if (config.default > config.max) {
      throw new ShapeError("take default cannot exceed max");
    }
    return z3.number().int().min(1).max(config.max).default(config.default);
  }
  function validateShapeArgs(method, shape) {
    const allowed = METHOD_ALLOWED_ARGS[method];
    for (const key of Object.keys(shape)) {
      if (SHAPE_CONFIG_KEYS.has(key) && !allowed.has(key)) {
        throw new ShapeError(`Arg "${key}" not allowed for method "${method}"`);
      }
    }
    if (shape.include && shape.select) {
      throw new ShapeError('Shape config cannot define both "include" and "select".');
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
  }
  function buildShapeZodSchema(model, method, shape) {
    validateShapeArgs(method, shape);
    const schemaFields = {};
    let forcedWhere = {};
    let forcedIncludeTree = {};
    let forcedSelectTree = {};
    if (shape.where) {
      const { schema, forced } = buildWhereSchema(model, shape.where);
      if (schema)
        schemaFields["where"] = schema;
      forcedWhere = forced;
    }
    if (shape.include) {
      const { schema, forcedTree } = buildIncludeSchema(model, shape.include);
      schemaFields["include"] = schema;
      forcedIncludeTree = forcedTree;
    }
    if (shape.select) {
      const { schema, forcedTree } = buildSelectSchema(model, shape.select);
      schemaFields["select"] = schema;
      forcedSelectTree = forcedTree;
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
      schemaFields["skip"] = z3.number().int().min(0).optional();
    }
    if (shape.distinct) {
      schemaFields["distinct"] = buildDistinctSchema(model, shape.distinct);
    }
    if (shape._count) {
      schemaFields["_count"] = buildCountFieldSchema(model, shape._count, "_count");
    }
    if (shape._avg) {
      schemaFields["_avg"] = buildAggregateFieldSchema(model, "_avg", shape._avg);
    }
    if (shape._sum) {
      schemaFields["_sum"] = buildAggregateFieldSchema(model, "_sum", shape._sum);
    }
    if (shape._min) {
      schemaFields["_min"] = buildAggregateFieldSchema(model, "_min", shape._min);
    }
    if (shape._max) {
      schemaFields["_max"] = buildAggregateFieldSchema(model, "_max", shape._max);
    }
    if (shape.by) {
      schemaFields["by"] = buildBySchema(model, shape.by);
    }
    return {
      zodSchema: z3.object(schemaFields).strict(),
      forcedWhere,
      forcedIncludeTree,
      forcedSelectTree
    };
  }
  function mergeForced(where, forced) {
    if (!where)
      return forced;
    return { AND: [where, forced] };
  }
  function applyForcedTree(validated, key, tree) {
    const container = validated[key];
    if (!container)
      return;
    for (const [relName, forced] of Object.entries(tree)) {
      const relVal = container[relName];
      if (relVal === void 0)
        continue;
      if (relVal === true) {
        const expanded = {};
        if (forced.where)
          expanded.where = forced.where;
        if (forced.include) {
          expanded.include = buildForcedOnlyContainer(forced.include);
          applyForcedTree(expanded, "include", forced.include);
        }
        if (forced.select) {
          expanded.select = buildForcedOnlyContainer(forced.select);
          applyForcedTree(expanded, "select", forced.select);
        }
        if (expanded.include && expanded.select) {
          throw new ShapeError(
            `Forced tree for relation "${relName}" produces both "include" and "select". Prisma does not allow both at the same level.`
          );
        }
        container[relName] = Object.keys(expanded).length > 0 ? expanded : true;
        continue;
      }
      if (isPlainObject(relVal)) {
        const relObj = relVal;
        if (forced.where) {
          relObj.where = mergeForced(
            relObj.where,
            forced.where
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
        if (relObj.include && relObj.select) {
          throw new ShapeError(
            `Relation "${relName}" has both "include" and "select" after forced tree merge. Prisma does not allow both at the same level.`
          );
        }
      }
    }
  }
  function buildForcedOnlyContainer(tree) {
    const result = {};
    for (const [relName, forced] of Object.entries(tree)) {
      const nested = {};
      if (forced.where)
        nested.where = forced.where;
      if (forced.include)
        nested.include = buildForcedOnlyContainer(forced.include);
      if (forced.select)
        nested.select = buildForcedOnlyContainer(forced.select);
      result[relName] = Object.keys(nested).length > 0 ? nested : true;
    }
    return result;
  }
  function matchCaller(shapes, caller) {
    if (Object.hasOwn(shapes, caller)) {
      return { key: caller, shape: shapes[caller] };
    }
    const matches = [];
    for (const [pattern, shape] of Object.entries(shapes)) {
      if (!pattern.includes(":"))
        continue;
      const patternParts = pattern.split("/");
      const callerParts = caller.split("/");
      if (patternParts.length !== callerParts.length)
        continue;
      let ok = true;
      for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i];
        if (p.startsWith(":"))
          continue;
        if (p !== callerParts[i]) {
          ok = false;
          break;
        }
      }
      if (ok)
        matches.push({ key: pattern, shape });
    }
    if (matches.length === 0)
      return null;
    if (matches.length > 1) {
      throw new ShapeError(
        `Caller "${caller}" matches multiple patterns: ${matches.map((m) => `"${m.key}"`).join(", ")}`
      );
    }
    return matches[0];
  }
  function buildQuerySchema(model, method, config) {
    const isSingleShape = typeof config === "function" || isShapeConfig(config);
    const builtCache = /* @__PURE__ */ new Map();
    if (isSingleShape && typeof config !== "function") {
      const built = buildShapeZodSchema(model, method, config);
      builtCache.set("_default", built);
    }
    if (!isSingleShape) {
      for (const key of Object.keys(config)) {
        if (RESERVED_CALLER_KEYS.has(key)) {
          throw new ShapeError(
            `Caller key "${key}" collides with reserved shape config key. Rename the caller path.`
          );
        }
      }
      for (const [key, shapeOrFn] of Object.entries(config)) {
        if (typeof shapeOrFn !== "function") {
          const built = buildShapeZodSchema(model, method, shapeOrFn);
          builtCache.set(key, built);
        }
      }
    }
    return {
      schemas: Object.fromEntries(
        [...builtCache.entries()].map(([k, v]) => [k, v.zodSchema])
      ),
      parse(body, opts) {
        let built;
        if (isSingleShape) {
          if (typeof config === "function") {
            requireContext(opts?.ctx, "shape function");
            const resolvedShape = config(opts.ctx);
            built = buildShapeZodSchema(model, method, resolvedShape);
          } else {
            built = builtCache.get("_default");
          }
        } else {
          if (!isPlainObject(body)) {
            throw new ShapeError("Request body must be an object");
          }
          const caller = body.caller;
          if (typeof caller !== "string") {
            throw new ShapeError('Missing "caller" field in request body');
          }
          const matched = matchCaller(config, caller);
          if (!matched) {
            const allowed = Object.keys(config);
            throw new CallerError(`${caller}. Allowed callers: ${allowed.map((k) => `"${k}"`).join(", ")}`);
          }
          const shapeKey = matched.key;
          const shapeOrFn = matched.shape;
          if (typeof shapeOrFn === "function") {
            requireContext(opts?.ctx, "shape function");
            const resolvedShape = shapeOrFn(opts.ctx);
            built = buildShapeZodSchema(model, method, resolvedShape);
          } else {
            built = builtCache.get(shapeKey);
          }
          const { caller: _, ...rest } = body;
          body = rest;
        }
        const validated = built.zodSchema.parse(body);
        if (Object.keys(built.forcedWhere).length > 0) {
          validated.where = mergeForced(
            validated.where,
            built.forcedWhere
          );
        }
        if (Object.keys(built.forcedIncludeTree).length > 0) {
          applyForcedTree(validated, "include", built.forcedIncludeTree);
        }
        if (Object.keys(built.forcedSelectTree).length > 0) {
          applyForcedTree(validated, "select", built.forcedSelectTree);
        }
        return validated;
      }
    };
  }
  return { buildQuerySchema };
}

// src/runtime/scope-extension.ts
var READ_OPS = /* @__PURE__ */ new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count"
]);
var AGGREGATE_OPS = /* @__PURE__ */ new Set([
  "aggregate",
  "groupBy"
]);
var FIND_UNIQUE_OPS = /* @__PURE__ */ new Set([
  "findUnique",
  "findUniqueOrThrow"
]);
var CREATE_OPS = /* @__PURE__ */ new Set([
  "create",
  "createMany",
  "createManyAndReturn"
]);
var MUTATION_WITH_WHERE_OPS = /* @__PURE__ */ new Set([
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany"
]);
function buildAndConditions(existingWhere, conditions) {
  if (existingWhere)
    return { AND: [existingWhere, ...conditions] };
  if (conditions.length === 1)
    return conditions[0];
  return { AND: conditions };
}
function isComparableScopeValue(v) {
  const t = typeof v;
  return t === "string" || t === "number" || t === "bigint";
}
function looseEqual(a, b) {
  if (a === b)
    return true;
  if (!isComparableScopeValue(a) || !isComparableScopeValue(b))
    return false;
  return String(a) === String(b);
}
function buildFkSelect(fks) {
  const select = {};
  for (const fk of fks)
    select[fk] = true;
  return select;
}
function pickMissingFksFromResult(result, fks) {
  const missing = [];
  for (const fk of fks) {
    if (!(fk in result))
      missing.push(fk);
  }
  return missing;
}
function validateScopeValue(root, value) {
  if (typeof value === "string" && value.length === 0) {
    throw new PolicyError(
      `Empty string scope value for root "${root}". This is almost certainly a bug in the context function.`
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new PolicyError(
      `Invalid numeric scope value for root "${root}": ${value}. This is almost certainly a bug in the context function.`
    );
  }
}
function stripScopeRelations(data, scopes) {
  for (const scope of scopes) {
    delete data[scope.relationName];
  }
}
function createScopeExtension(scopeMap, contextFn, guardConfig, logger) {
  const log = logger ?? { warn: (msg) => console.warn(msg) };
  const findUniqueMode = guardConfig.findUniqueMode ?? "verify";
  return {
    name: "prisma-guard-scope",
    query: {
      $allOperations({ model, operation, args, query }) {
        if (!model || !scopeMap[model])
          return query(args);
        const ctx = contextFn();
        const scopes = scopeMap[model];
        const presentScopes = scopes.filter((s) => ctx[s.root] != null);
        for (const s of presentScopes) {
          validateScopeValue(s.root, ctx[s.root]);
        }
        const presentConditions = presentScopes.map((s) => ({ [s.fk]: ctx[s.root] }));
        const missingRoots = scopes.filter((s) => ctx[s.root] == null).map((s) => s.root);
        const isMutation = CREATE_OPS.has(operation) || MUTATION_WITH_WHERE_OPS.has(operation) || operation === "upsert";
        if (missingRoots.length > 0) {
          if (isMutation || guardConfig.onMissingScopeContext === "error") {
            throw new PolicyError(
              `Missing scope context for model "${model}": roots ${missingRoots.map((r) => `"${r}"`).join(", ")} not provided. All scope roots must be present.`
            );
          }
          if (guardConfig.onMissingScopeContext === "warn") {
            log.warn(
              `prisma-guard: Missing scope context for model "${model}": roots ${missingRoots.map((r) => `"${r}"`).join(", ")} not provided. Read proceeding with partial scope.`
            );
          }
          if (presentConditions.length === 0) {
            return query(args);
          }
        }
        const conditions = presentConditions;
        const overrides = Object.fromEntries(
          presentScopes.map((s) => [s.fk, ctx[s.root]])
        );
        if (operation === "upsert") {
          throw new ShapeError(
            `Scoped model "${model}" cannot use upsert via extension. Handle upsert explicitly in route logic.`
          );
        }
        if (FIND_UNIQUE_OPS.has(operation)) {
          if (findUniqueMode === "reject") {
            throw new PolicyError(
              `Scoped model "${model}" does not allow ${operation} via scope extension (findUniqueMode is "reject"). Use findFirst with explicit where conditions instead.`
            );
          }
          return handleFindUnique(args, query, conditions, scopes, operation);
        }
        const nextArgs = { ...args };
        if (READ_OPS.has(operation)) {
          nextArgs.where = buildAndConditions(args.where, conditions);
          return query(nextArgs);
        }
        if (AGGREGATE_OPS.has(operation)) {
          nextArgs.where = buildAndConditions(args.where, conditions);
          if (operation === "groupBy" && !nextArgs.by) {
            throw new ShapeError(
              `prisma-guard: groupBy on scoped model "${model}" requires "by" argument.`
            );
          }
          return query(nextArgs);
        }
        if (CREATE_OPS.has(operation)) {
          if (operation === "createMany" || operation === "createManyAndReturn") {
            if (!Array.isArray(args.data)) {
              throw new ShapeError(`${operation} expects data to be an array`);
            }
            if (args.data.length === 0) {
              throw new ShapeError(`${operation} received empty data array`);
            }
            nextArgs.data = args.data.map((d) => {
              const item = { ...d, ...overrides };
              stripScopeRelations(item, scopes);
              return item;
            });
          } else {
            if (args.data === void 0 || args.data === null || typeof args.data !== "object") {
              throw new ShapeError(`${operation} expects data to be an object`);
            }
            nextArgs.data = { ...args.data, ...overrides };
            stripScopeRelations(nextArgs.data, scopes);
          }
          return query(nextArgs);
        }
        if (MUTATION_WITH_WHERE_OPS.has(operation)) {
          nextArgs.where = buildAndConditions(args.where, conditions);
          if (args.data !== void 0 && args.data !== null) {
            if (typeof args.data !== "object" || Array.isArray(args.data)) {
              throw new ShapeError(`${operation} expects data to be an object`);
            }
            nextArgs.data = { ...args.data };
            for (const scope of scopes) {
              delete nextArgs.data[scope.fk];
            }
            stripScopeRelations(nextArgs.data, scopes);
          }
          return query(nextArgs);
        }
        throw new ShapeError(
          `Unknown operation "${operation}" on scoped model "${model}". Update prisma-guard to handle this operation.`
        );
      }
    }
  };
}
async function handleFindUnique(args, query, conditions, scopes, operation) {
  const nextArgs = { ...args };
  const injectedFks = [];
  const originalSelect = args?.select;
  const fks = scopes.map((s) => s.fk);
  if (originalSelect) {
    nextArgs.select = { ...originalSelect };
    for (const fk of fks) {
      if (!originalSelect[fk]) {
        nextArgs.select[fk] = true;
        injectedFks.push(fk);
      }
    }
  }
  const result = await query(nextArgs);
  if (result === null)
    return result;
  if (typeof result !== "object" || result === null) {
    throw new ShapeError("findUnique result must be an object or null");
  }
  const resultObj = result;
  let verifyObj = resultObj;
  const missingFks = pickMissingFksFromResult(resultObj, fks);
  if (missingFks.length > 0) {
    const where = args?.where;
    if (!where || typeof where !== "object" || Array.isArray(where)) {
      throw new PolicyError(
        `prisma-guard: Cannot verify scope \u2014 missing FK fields (${missingFks.join(", ")}) and findUnique args.where is not a valid object.`
      );
    }
    let verifyResult;
    try {
      verifyResult = await query({ where, select: buildFkSelect(fks) });
    } catch (err) {
      throw new ShapeError(
        `prisma-guard: Scope verification query failed for findUnique: ${err?.message ?? String(err)}`,
        { cause: err }
      );
    }
    if (verifyResult === null) {
      throw new ShapeError("prisma-guard: Scope verification query returned null for an existing findUnique result");
    }
    if (typeof verifyResult !== "object" || verifyResult === null) {
      throw new ShapeError("prisma-guard: Scope verification result must be an object");
    }
    verifyObj = verifyResult;
  }
  for (const condition of conditions) {
    const [fk, value] = Object.entries(condition)[0];
    if (!(fk in verifyObj)) {
      throw new PolicyError(
        `prisma-guard: Cannot verify scope on "${fk}" \u2014 field not present in verification result. Ensure FK fields are selectable.`
      );
    }
    if (!looseEqual(verifyObj[fk], value)) {
      if (operation === "findUniqueOrThrow") {
        throw new PolicyError("Record not accessible in current scope");
      }
      return null;
    }
  }
  if (injectedFks.length > 0) {
    const cleaned = { ...resultObj };
    for (const fk of injectedFks) {
      delete cleaned[fk];
    }
    return cleaned;
  }
  return result;
}

// src/runtime/guard.ts
function createGuard(config) {
  const schemaBuilder = createSchemaBuilder(
    config.typeMap,
    config.zodChains,
    config.enumMap
  );
  const queryBuilder = createQueryBuilder(
    config.typeMap,
    config.enumMap
  );
  return {
    input: (model, opts) => schemaBuilder.buildInputSchema(model, opts),
    model: (model, opts) => schemaBuilder.buildModelSchema(model, opts),
    query: (model, method, config2) => queryBuilder.buildQuerySchema(model, method, config2),
    extension: (contextFn) => createScopeExtension(config.scopeMap, contextFn, config.guardConfig, config.logger)
  };
}
export {
  CallerError,
  PolicyError,
  ShapeError,
  createGuard
};
//# sourceMappingURL=index.js.map