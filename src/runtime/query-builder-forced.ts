import { z } from 'zod'
import type { UniqueMap } from '../shared/types.js'
import { ShapeError } from '../shared/errors.js'
import { isPlainObject } from '../shared/utils.js'
import { deepClone } from '../shared/deep-clone.js'

export interface WhereForced {
  conditions: Record<string, unknown>
  relations: Record<string, Record<string, WhereForced>>
}

export const EMPTY_WHERE_FORCED: WhereForced = { conditions: {}, relations: {} }

export function hasWhereForced(f: WhereForced): boolean {
  return Object.keys(f.conditions).length > 0 || Object.keys(f.relations).length > 0
}

export interface ForcedTree {
  where?: WhereForced
  include?: Record<string, ForcedTree>
  select?: Record<string, ForcedTree>
  _countWhere?: Record<string, WhereForced>
  _countWherePlacement?: 'include' | 'select'
}

export interface BuiltShape {
  zodSchema: z.ZodObject<any>
  forcedWhere: WhereForced
  forcedOnlyWhereKeys: Set<string>
  forcedIncludeTree: Record<string, ForcedTree>
  forcedSelectTree: Record<string, ForcedTree>
  forcedIncludeCountWhere: Record<string, WhereForced>
  forcedSelectCountWhere: Record<string, WhereForced>
}

export function mergeWhereForced(
  where: Record<string, unknown> | undefined,
  forced: WhereForced,
): Record<string, unknown> {
  if (!hasWhereForced(forced)) return where ?? {}

  let result: Record<string, unknown> = where ? deepClone(where) : {}

  for (const [relName, opMap] of Object.entries(forced.relations)) {
    if (!result[relName] || typeof result[relName] !== 'object') {
      result[relName] = {}
    }
    const relObj = result[relName] as Record<string, unknown>
    for (const [op, nestedForced] of Object.entries(opMap)) {
      relObj[op] = mergeWhereForced(
        relObj[op] as Record<string, unknown> | undefined,
        nestedForced,
      )
    }
  }

  if (Object.keys(forced.conditions).length > 0) {
    const scalarClone = deepClone(forced.conditions)
    if (Object.keys(result).length === 0) {
      result = scalarClone
    } else {
      result = { AND: [result, scalarClone] }
    }
  }

  return result
}

export function mergeUniqueWhereForced(
  where: Record<string, unknown> | undefined,
  forced: WhereForced,
): Record<string, unknown> {
  if (!hasWhereForced(forced)) return where ?? {}

  let result: Record<string, unknown> = where ? { ...where } : {}

  for (const [relName, opMap] of Object.entries(forced.relations)) {
    if (!result[relName] || typeof result[relName] !== 'object') {
      result[relName] = {}
    }
    const relObj = result[relName] as Record<string, unknown>
    for (const [op, nestedForced] of Object.entries(opMap)) {
      relObj[op] = mergeWhereForced(
        relObj[op] as Record<string, unknown> | undefined,
        nestedForced,
      )
    }
  }

  if (Object.keys(forced.conditions).length > 0) {
    const conditions = [deepClone(forced.conditions)]
    const existing = result.AND
    if (existing) {
      if (Array.isArray(existing)) {
        conditions.unshift(...existing)
      } else {
        conditions.unshift(existing as Record<string, unknown>)
      }
    }
    result.AND = conditions
  }

  return result
}

export function applyBuiltShape(
  built: BuiltShape,
  body: unknown,
  isUniqueMethod: boolean,
): Record<string, unknown> {
  let parseable = body

  if (isPlainObject(body)) {
    const bodyObj = body as Record<string, unknown>

    if (isPlainObject(bodyObj.where)) {
      const where = { ...(bodyObj.where as Record<string, unknown>) }
      let modified = false

      if (built.forcedOnlyWhereKeys.size > 0) {
        for (const key of built.forcedOnlyWhereKeys) {
          if (key in where) {
            delete where[key]
            modified = true
          }
        }
      }

      if (Object.keys(where).length === 0 && hasWhereForced(built.forcedWhere)) {
        const { where: _, ...rest } = bodyObj
        parseable = rest
      } else if (modified) {
        parseable = { ...bodyObj, where }
      }
    } else if ('where' in bodyObj && hasWhereForced(built.forcedWhere) && !built.zodSchema.shape.where) {
      const { where: _, ...rest } = bodyObj
      parseable = rest
    }
  }

  const validated = built.zodSchema.parse(parseable) as Record<string, unknown>

  if (hasWhereForced(built.forcedWhere)) {
    validated.where = isUniqueMethod
      ? mergeUniqueWhereForced(
          validated.where as Record<string, unknown> | undefined,
          built.forcedWhere,
        )
      : mergeWhereForced(
          validated.where as Record<string, unknown> | undefined,
          built.forcedWhere,
        )
  }

  if (Object.keys(built.forcedIncludeTree).length > 0) {
    applyForcedTree(validated, 'include', built.forcedIncludeTree)
  }

  if (Object.keys(built.forcedSelectTree).length > 0) {
    applyForcedTree(validated, 'select', built.forcedSelectTree)
  }

  if (Object.keys(built.forcedIncludeCountWhere).length > 0) {
    const ic = validated.include as Record<string, unknown> | undefined
    if (ic) applyForcedCountWhere(ic, built.forcedIncludeCountWhere)
  }

  if (Object.keys(built.forcedSelectCountWhere).length > 0) {
    const sc = validated.select as Record<string, unknown> | undefined
    if (sc) applyForcedCountWhere(sc, built.forcedSelectCountWhere)
  }

  return validated
}

function buildCountForPlacement(
  countWhere: Record<string, WhereForced>,
): Record<string, unknown> {
  const countSelect: Record<string, unknown> = {}
  for (const [countRel, countForced] of Object.entries(countWhere)) {
    countSelect[countRel] = { where: mergeWhereForced(undefined, countForced) }
  }
  return { _count: { select: countSelect } }
}

export function applyForcedTree(
  validated: Record<string, unknown>,
  key: 'include' | 'select',
  tree: Record<string, ForcedTree>,
): void {
  const container = validated[key] as Record<string, unknown> | undefined
  if (!container) return

  for (const [relName, forced] of Object.entries(tree)) {
    const relVal = container[relName]
    if (relVal === undefined) continue

    if (relVal === true) {
      const expanded: Record<string, unknown> = {}
      if (forced.where && hasWhereForced(forced.where)) {
        expanded.where = mergeWhereForced(undefined, forced.where)
      }
      if (forced.include) {
        expanded.include = buildForcedOnlyContainer(forced.include)
        applyForcedTree(expanded, 'include', forced.include)
      }
      if (forced.select) {
        expanded.select = buildForcedOnlyContainer(forced.select)
        applyForcedTree(expanded, 'select', forced.select)
      }
      if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
        const placement = forced._countWherePlacement ?? 'include'
        if (!expanded[placement]) expanded[placement] = {}
        const placementObj = expanded[placement] as Record<string, unknown>
        Object.assign(placementObj, buildCountForPlacement(forced._countWhere))
      }
      if (expanded.include && expanded.select) {
        throw new ShapeError(
          `Forced tree for relation "${relName}" produces both "include" and "select". Prisma does not allow both at the same level.`,
        )
      }
      container[relName] = Object.keys(expanded).length > 0 ? expanded : true
      continue
    }

    if (isPlainObject(relVal)) {
      const relObj = relVal as Record<string, unknown>
      if (forced.where && hasWhereForced(forced.where)) {
        relObj.where = mergeWhereForced(
          relObj.where as Record<string, unknown> | undefined,
          forced.where,
        )
      }
      if (forced.include) {
        if (!relObj.include) relObj.include = buildForcedOnlyContainer(forced.include)
        applyForcedTree(relObj, 'include', forced.include)
      }
      if (forced.select) {
        if (!relObj.select) relObj.select = buildForcedOnlyContainer(forced.select)
        applyForcedTree(relObj, 'select', forced.select)
      }
      if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
        const placement = forced._countWherePlacement ?? 'include'
        const projContainer = relObj[placement] as Record<string, unknown> | undefined
        if (projContainer) {
          applyForcedCountWhere(projContainer, forced._countWhere)
        }
      }
      if (relObj.include && relObj.select) {
        throw new ShapeError(
          `Relation "${relName}" has both "include" and "select" after forced tree merge. Prisma does not allow both at the same level.`,
        )
      }
    }
  }
}

export function buildForcedOnlyContainer(
  tree: Record<string, ForcedTree>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [relName, forced] of Object.entries(tree)) {
    const nested: Record<string, unknown> = {}
    if (forced.where && hasWhereForced(forced.where)) {
      nested.where = mergeWhereForced(undefined, forced.where)
    }
    if (forced.include) nested.include = buildForcedOnlyContainer(forced.include)
    if (forced.select) nested.select = buildForcedOnlyContainer(forced.select)
    if (forced._countWhere && Object.keys(forced._countWhere).length > 0) {
      const placement = forced._countWherePlacement ?? 'include'
      if (!nested[placement]) nested[placement] = {}
      const placementObj = nested[placement] as Record<string, unknown>
      Object.assign(placementObj, buildCountForPlacement(forced._countWhere))
    }
    result[relName] = Object.keys(nested).length > 0 ? nested : true
  }
  return result
}

export function applyForcedCountWhere(
  container: Record<string, unknown>,
  forcedCountWhere: Record<string, WhereForced>,
): void {
  const countVal = container._count
  if (!countVal || countVal === true || !isPlainObject(countVal)) return
  const countObj = countVal as Record<string, unknown>
  const selectVal = countObj.select
  if (!selectVal || !isPlainObject(selectVal)) return
  const selectObj = selectVal as Record<string, unknown>

  for (const [relName, forced] of Object.entries(forcedCountWhere)) {
    const relVal = selectObj[relName]
    if (relVal === undefined) continue

    if (relVal === true) {
      selectObj[relName] = { where: mergeWhereForced(undefined, forced) }
    } else if (isPlainObject(relVal)) {
      const relObj = relVal as Record<string, unknown>
      relObj.where = mergeWhereForced(
        relObj.where as Record<string, unknown> | undefined,
        forced,
      )
    }
  }
}

export function collectWhereFieldKeys(
  where: Record<string, unknown>,
): Set<string> {
  const keys = new Set<string>()
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND') {
      const items = Array.isArray(value) ? value : [value]
      for (const item of items) {
        if (isPlainObject(item)) {
          for (const k of collectWhereFieldKeys(item)) keys.add(k)
        }
      }
    } else if (key !== 'OR' && key !== 'NOT') {
      keys.add(key)
    }
  }
  return keys
}

export function validateResolvedUniqueWhere(
  model: string,
  where: Record<string, unknown>,
  method: string,
  uniqueMap: UniqueMap,
): void {
  const constraints = uniqueMap[model]
  if (!constraints || constraints.length === 0) return

  const fieldKeys = collectWhereFieldKeys(where)
  const covered = constraints.some(constraint =>
    constraint.every(field => fieldKeys.has(field)),
  )

  if (!covered) {
    const constraintDesc = constraints.map(c => `(${c.join(', ')})`).join(' | ')
    throw new ShapeError(
      `${method} on model "${model}" requires resolved where to cover a unique constraint: ${constraintDesc}`,
    )
  }
}

function collectEqualityFields(
  where: Record<string, unknown>,
  model: string | undefined,
  typeMap?: Record<string, Record<string, { isRelation: boolean }>>,
): Set<string> {
  const combinators = new Set(['AND', 'OR', 'NOT'])
  const fields = new Set<string>()

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND') {
      if (isPlainObject(value)) {
        for (const f of collectEqualityFields(value, model, typeMap)) {
          fields.add(f)
        }
      }
      continue
    }
    if (combinators.has(key)) continue
    if (typeMap && model && typeMap[model]?.[key]?.isRelation) continue
    if (!value || !isPlainObject(value)) continue
    if (Object.keys(value).every(op => op === 'equals')) {
      fields.add(key)
    }
  }

  return fields
}

export function validateUniqueEquality(
  model: string,
  where: Record<string, unknown>,
  method: string,
  uniqueMap: UniqueMap,
  typeMap?: Record<string, Record<string, { isRelation: boolean }>>,
): void {
  const constraints = uniqueMap[model]
  if (!constraints || constraints.length === 0) return

  const equalityFields = collectEqualityFields(where, model, typeMap)

  const valid = constraints.some(constraint =>
    constraint.every(field => equalityFields.has(field)),
  )

  if (!valid) {
    const constraintDesc = constraints.map(c => `(${c.join(', ')})`).join(' | ')
    throw new ShapeError(
      `${method} on model "${model}" requires where to cover a unique constraint with equality operators only: ${constraintDesc}`,
    )
  }
}