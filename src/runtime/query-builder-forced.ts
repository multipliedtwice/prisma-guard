import { z } from "zod";
import type { UniqueMap } from "../shared/types.js";
import { isPlainObject } from "../shared/utils.js";
import { deepClone } from "../shared/deep-clone.js";
import { formatZodError, ShapeError } from "../shared/errors.js";
import { isForcedValue } from "../shared/constants.js";

export interface WhereForced {
  conditions: Record<string, unknown>;
  relations: Record<string, Record<string, WhereForced>>;
}

export const EMPTY_WHERE_FORCED: WhereForced = {
  conditions: {},
  relations: {},
};

export function hasWhereForced(f: WhereForced): boolean {
  return (
    Object.keys(f.conditions).length > 0 || Object.keys(f.relations).length > 0
  );
}

export interface ForcedTree {
  where?: WhereForced;
  include?: Record<string, ForcedTree>;
  select?: Record<string, ForcedTree>;
  _countWhere?: Record<string, WhereForced>;
  _countWherePlacement?: "include" | "select";
}

export interface BuiltShape {
  zodSchema: z.ZodObject<any>;
  forcedWhere: WhereForced;
  forcedOnlyWhereKeys: Set<string>;
  forcedIncludeTree: Record<string, ForcedTree>;
  forcedSelectTree: Record<string, ForcedTree>;
  forcedIncludeCountWhere: Record<string, WhereForced>;
  forcedSelectCountWhere: Record<string, WhereForced>;
}

type UniqueConstraintLike = {
  selector: string;
  fields: readonly string[];
};

export function mergeWhereForced(
  where: Record<string, unknown> | undefined,
  forced: WhereForced,
): Record<string, unknown> {
  if (!hasWhereForced(forced)) return where ?? {};

  let result: Record<string, unknown> = where ? deepClone(where) : {};

  for (const [relName, opMap] of Object.entries(forced.relations)) {
    if (!result[relName] || typeof result[relName] !== "object") {
      result[relName] = {};
    }

    const relObj = result[relName] as Record<string, unknown>;

    for (const [op, nestedForced] of Object.entries(opMap)) {
      relObj[op] = mergeWhereForced(
        relObj[op] as Record<string, unknown> | undefined,
        nestedForced,
      );
    }
  }

  if (Object.keys(forced.conditions).length > 0) {
    const scalarClone = deepClone(forced.conditions);

    if (Object.keys(result).length === 0) {
      result = scalarClone;
    } else {
      result = { AND: [result, scalarClone] };
    }
  }

  return result;
}

function uniqueValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => uniqueValuesEqual(v, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every((key) => key in b && uniqueValuesEqual(a[key], b[key]));
  }

  return false;
}

function mergeUniqueValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const cloned = deepClone(value);

  if (!(key in target)) {
    target[key] = cloned;
    return;
  }

  const existing = target[key];

  if (isPlainObject(existing) && isPlainObject(cloned)) {
    const merged = { ...existing };

    for (const [nestedKey, nestedValue] of Object.entries(cloned)) {
      if (
        nestedKey in merged &&
        !uniqueValuesEqual(merged[nestedKey], nestedValue)
      ) {
        throw new ShapeError(
          `Conflicting unique where value for "${key}.${nestedKey}"`,
        );
      }

      merged[nestedKey] = nestedValue;
    }

    target[key] = merged;
    return;
  }

  if (!uniqueValuesEqual(existing, cloned)) {
    throw new ShapeError(`Conflicting unique where value for "${key}"`);
  }
}

export function mergeUniqueWhereForced(
  where: Record<string, unknown> | undefined,
  forced: WhereForced,
): Record<string, unknown> {
  if (!hasWhereForced(forced)) return where ?? {};

  if (Object.keys(forced.relations).length > 0) {
    throw new ShapeError(
      "Unique where forced conditions cannot contain relation filters",
    );
  }

  const result: Record<string, unknown> = where ? deepClone(where) : {};

  for (const [key, value] of Object.entries(forced.conditions)) {
    mergeUniqueValue(result, key, value);
  }

  return result;
}

export function applyBuiltShape(
  built: BuiltShape,
  body: unknown,
  isUniqueMethod: boolean,
  modelName?: string,
): Record<string, unknown> {
  let parseable = body;
  const hasWhereInSchema = "where" in built.zodSchema.shape;

  if (isPlainObject(body)) {
    const bodyObj = body as Record<string, unknown>;

    if ("select" in bodyObj && "include" in bodyObj) {
      throw new ShapeError('Request cannot define both "include" and "select"');
    }

    if ("where" in bodyObj) {
      if (!hasWhereInSchema) {
        const { where: _, ...rest } = bodyObj;
        parseable = rest;
      } else if (
        isUniqueMethod &&
        hasWhereForced(built.forcedWhere) &&
        isPlainObject(bodyObj.where)
      ) {
        const where = stripUniqueWhereForcedInput(
          bodyObj.where as Record<string, unknown>,
          built.forcedWhere,
        );

        if (Object.keys(where).length === 0) {
          const { where: _, ...rest } = bodyObj;
          parseable = rest;
        } else {
          parseable = { ...bodyObj, where };
        }
      } else if (
        built.forcedOnlyWhereKeys.size > 0 &&
        isPlainObject(bodyObj.where)
      ) {
        const where = { ...(bodyObj.where as Record<string, unknown>) };

        for (const key of built.forcedOnlyWhereKeys) {
          delete where[key];
        }

        if (
          Object.keys(where).length === 0 &&
          hasWhereForced(built.forcedWhere)
        ) {
          const { where: _, ...rest } = bodyObj;
          parseable = rest;
        } else {
          parseable = { ...bodyObj, where };
        }
      }
    }
  }

  let validated: Record<string, unknown>;

  try {
    validated = built.zodSchema.parse(parseable) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ShapeError) throw err;

    if (err && typeof err === "object" && "issues" in err) {
      const context = modelName
        ? `Invalid query on model "${modelName}"`
        : "Invalid query";

      throw new ShapeError(`${context}: ${formatZodError(err as any)}`, {
        cause: err,
      });
    }

    throw err;
  }

  if (hasWhereForced(built.forcedWhere)) {
    validated.where = isUniqueMethod
      ? mergeUniqueWhereForced(
          validated.where as Record<string, unknown> | undefined,
          built.forcedWhere,
        )
      : mergeWhereForced(
          validated.where as Record<string, unknown> | undefined,
          built.forcedWhere,
        );
  }

  if (Object.keys(built.forcedIncludeTree).length > 0) {
    applyForcedTree(validated, "include", built.forcedIncludeTree);
  }

  if (Object.keys(built.forcedSelectTree).length > 0) {
    applyForcedTree(validated, "select", built.forcedSelectTree);
  }

  if (Object.keys(built.forcedIncludeCountWhere).length > 0) {
    const ic = validated.include as Record<string, unknown> | undefined;
    if (ic) applyForcedCountWhere(ic, built.forcedIncludeCountWhere);
  }

  if (Object.keys(built.forcedSelectCountWhere).length > 0) {
    const sc = validated.select as Record<string, unknown> | undefined;
    if (sc) applyForcedCountWhere(sc, built.forcedSelectCountWhere);
  }

  return validated;
}

function buildCountForPlacement(
  countWhere: Record<string, WhereForced>,
): Record<string, unknown> {
  const countSelect: Record<string, unknown> = {};

  for (const [countRel, countForced] of Object.entries(countWhere)) {
    countSelect[countRel] = { where: mergeWhereForced(undefined, countForced) };
  }

  return { _count: { select: countSelect } };
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

      if (forced.where && hasWhereForced(forced.where)) {
        expanded.where = mergeWhereForced(undefined, forced.where);
      }

      if (forced.include) {
        expanded.include = buildForcedOnlyContainer(forced.include);
        applyForcedTree(expanded, "include", forced.include);
      }

      if (forced.select) {
        expanded.select = buildForcedOnlyContainer(forced.select);
        applyForcedTree(expanded, "select", forced.select);
      }

      if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
        const placement = forced._countWherePlacement ?? "include";

        if (!expanded[placement]) expanded[placement] = {};

        const placementObj = expanded[placement] as Record<string, unknown>;
        Object.assign(placementObj, buildCountForPlacement(forced._countWhere));
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

      if (forced.where && hasWhereForced(forced.where)) {
        relObj.where = mergeWhereForced(
          relObj.where as Record<string, unknown> | undefined,
          forced.where,
        );
      }

      if (forced.include) {
        if (!relObj.include) {
          relObj.include = buildForcedOnlyContainer(forced.include);
        }

        applyForcedTree(relObj, "include", forced.include);
      }

      if (forced.select) {
        if (!relObj.select) {
          relObj.select = buildForcedOnlyContainer(forced.select);
        }

        applyForcedTree(relObj, "select", forced.select);
      }

      if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
        const placement = forced._countWherePlacement ?? "include";
        const projContainer = relObj[placement] as
          | Record<string, unknown>
          | undefined;

        if (projContainer) {
          applyForcedCountWhere(projContainer, forced._countWhere);
        }
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

    if (forced.where && hasWhereForced(forced.where)) {
      nested.where = mergeWhereForced(undefined, forced.where);
    }

    if (forced.include) {
      nested.include = buildForcedOnlyContainer(forced.include);
    }

    if (forced.select) {
      nested.select = buildForcedOnlyContainer(forced.select);
    }

    if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
      const placement = forced._countWherePlacement ?? "include";

      if (!nested[placement]) nested[placement] = {};

      const placementObj = nested[placement] as Record<string, unknown>;
      Object.assign(placementObj, buildCountForPlacement(forced._countWhere));
    }

    result[relName] = Object.keys(nested).length > 0 ? nested : true;
  }

  return result;
}

export function applyForcedCountWhere(
  container: Record<string, unknown>,
  forcedCountWhere: Record<string, WhereForced>,
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
      selectObj[relName] = { where: mergeWhereForced(undefined, forced) };
    } else if (isPlainObject(relVal)) {
      const relObj = relVal as Record<string, unknown>;

      relObj.where = mergeWhereForced(
        relObj.where as Record<string, unknown> | undefined,
        forced,
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
          for (const k of collectWhereFieldKeys(item)) {
            keys.add(k);
          }
        }
      }
    } else if (key !== "OR" && key !== "NOT") {
      keys.add(key);
    }
  }

  return keys;
}

function formatUniqueConstraint(constraint: UniqueConstraintLike): string {
  return constraint.fields.length === 1
    ? constraint.selector
    : `${constraint.selector}(${constraint.fields.join(", ")})`;
}

function formatUniqueConstraints(
  constraints: readonly UniqueConstraintLike[],
): string {
  return constraints.map(formatUniqueConstraint).join(" | ");
}

function resolvedWhereCoversConstraint(
  where: Record<string, unknown>,
  constraint: UniqueConstraintLike,
): boolean {
  if (constraint.fields.length === 1) {
    return constraint.fields[0] in where;
  }

  const value = where[constraint.selector];
  if (!isPlainObject(value)) return false;

  return constraint.fields.every((field) => field in value);
}

export function validateResolvedUniqueWhere(
  model: string,
  where: Record<string, unknown>,
  method: string,
  uniqueMap: UniqueMap,
): void {
  const constraints = uniqueMap[model];
  if (!constraints || constraints.length === 0) return;

  const covered = constraints.some((constraint) =>
    resolvedWhereCoversConstraint(where, constraint),
  );

  if (!covered) {
    throw new ShapeError(
      `${method} on model "${model}" requires resolved where to cover a unique constraint: ${formatUniqueConstraints(constraints)}`,
    );
  }
}

function assertDirectUniqueShapeValue(
  model: string | undefined,
  field: string,
  value: unknown,
  typeMap?: Record<string, Record<string, { isRelation: boolean }>>,
): void {
  if (typeMap && model) {
    const fieldMeta = typeMap[model]?.[field];

    if (!fieldMeta) {
      throw new ShapeError(`Unknown unique where field "${model}.${field}"`);
    }

    if (fieldMeta.isRelation) {
      throw new ShapeError(
        `Relation field "${model}.${field}" cannot be used in unique where`,
      );
    }
  }

  if (isForcedValue(value)) return;

  if (isPlainObject(value)) {
    const keys = Object.keys(value);

    throw new ShapeError(
      `Invalid unique where shape for "${model ?? "unknown"}.${field}". Prisma WhereUniqueInput does not accept filter operator objects${keys.length ? `: ${keys.join(", ")}` : ""}. Use { ${field}: true } in guard shape and { ${field}: value } in request args.`,
    );
  }

  if (value === null || value === undefined) {
    throw new ShapeError(
      `Invalid unique where shape for "${model ?? "unknown"}.${field}". Unique fields must use true or a forced value.`,
    );
  }
}

function shapeCoversConstraint(
  where: Record<string, unknown>,
  constraint: UniqueConstraintLike,
  model: string,
  typeMap?: Record<string, Record<string, { isRelation: boolean }>>,
): boolean {
  if (constraint.fields.length === 1) {
    const field = constraint.fields[0];

    if (!(field in where)) return false;

    assertDirectUniqueShapeValue(model, field, where[field], typeMap);

    return true;
  }

  if (!(constraint.selector in where)) return false;

  const selectorValue = where[constraint.selector];

  if (isForcedValue(selectorValue)) return true;

  if (!isPlainObject(selectorValue)) {
    throw new ShapeError(
      `Compound unique selector "${model}.${constraint.selector}" must be an object with fields: ${constraint.fields.join(", ")}`,
    );
  }

  const allowed = new Set(constraint.fields);

  for (const key of Object.keys(selectorValue)) {
    if (!allowed.has(key)) {
      throw new ShapeError(
        `Unknown field "${key}" in compound unique selector "${model}.${constraint.selector}". Allowed fields: ${constraint.fields.join(", ")}`,
      );
    }
  }

  for (const field of constraint.fields) {
    if (!(field in selectorValue)) {
      throw new ShapeError(
        `Missing field "${field}" in compound unique selector "${model}.${constraint.selector}"`,
      );
    }

    assertDirectUniqueShapeValue(model, field, selectorValue[field], typeMap);
  }

  return true;
}

export function validateUniqueEquality(
  model: string,
  where: Record<string, unknown>,
  method: string,
  uniqueMap: UniqueMap,
  typeMap?: Record<string, Record<string, { isRelation: boolean }>>,
): void {
  const constraints = uniqueMap[model];
  if (!constraints || constraints.length === 0) return;

  const valid = constraints.some((constraint) =>
    shapeCoversConstraint(where, constraint, model, typeMap),
  );

  if (!valid) {
    throw new ShapeError(
      `${method} on model "${model}" requires unique where shape to cover a unique constraint using Prisma unique selector syntax: ${formatUniqueConstraints(constraints)}`,
    );
  }
}

export function stripUniqueWhereForcedInput(
  where: Record<string, unknown>,
  forced: WhereForced,
): Record<string, unknown> {
  const result = deepClone(where);

  for (const [key, forcedValue] of Object.entries(forced.conditions)) {
    if (!(key in result)) continue;

    const currentValue = result[key];

    if (isPlainObject(currentValue) && isPlainObject(forcedValue)) {
      const nested = { ...currentValue };

      for (const nestedKey of Object.keys(forcedValue)) {
        delete nested[nestedKey];
      }

      if (Object.keys(nested).length === 0) {
        delete result[key];
      } else {
        result[key] = nested;
      }

      continue;
    }

    delete result[key];
  }

  return result;
}
