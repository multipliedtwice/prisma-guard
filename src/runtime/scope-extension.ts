import type { ScopeMap, GuardGeneratedConfig, GuardLogger } from '../shared/types.js'
import { PolicyError, ShapeError } from '../shared/errors.js'

const READ_OPS = new Set([
  'findMany', 'findFirst',
  'findFirstOrThrow',
  'count',
])

const AGGREGATE_OPS = new Set([
  'aggregate', 'groupBy',
])

const FIND_UNIQUE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow',
])

const CREATE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn',
])

const MUTATION_WITH_WHERE_OPS = new Set([
  'update', 'updateMany', 'updateManyAndReturn',
  'delete', 'deleteMany',
])

function buildAndConditions(
  existingWhere: Record<string, unknown> | undefined,
  conditions: Record<string, unknown>[],
): Record<string, unknown> {
  if (existingWhere) return { AND: [existingWhere, ...conditions] }
  if (conditions.length === 1) return conditions[0]
  return { AND: conditions }
}

function isComparableScopeValue(v: unknown): v is string | number | bigint {
  const t = typeof v
  return t === 'string' || t === 'number' || t === 'bigint'
}

/**
 * Compares two scope values using string coercion.
 *
 * This intentionally treats numeric strings, numbers, and bigints as equal
 * when their string representations match (e.g. `1`, `"1"`, and `1n` are
 * all considered equal). This accommodates Prisma's type coercion behavior
 * where FK values may arrive as different JS types depending on the database
 * driver and adapter configuration.
 */
function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!isComparableScopeValue(a) || !isComparableScopeValue(b)) return false
  return String(a) === String(b)
}

function buildFkSelect(fks: string[]): Record<string, true> {
  const select: Record<string, true> = {}
  for (const fk of fks) select[fk] = true
  return select
}

function pickMissingFksFromResult(
  result: Record<string, unknown>,
  fks: string[],
): string[] {
  const missing: string[] = []
  for (const fk of fks) {
    if (!(fk in result)) missing.push(fk)
  }
  return missing
}

function validateScopeValue(root: string, value: unknown): void {
  if (typeof value === 'string' && value.length === 0) {
    throw new PolicyError(
      `Empty string scope value for root "${root}". This is almost certainly a bug in the context function.`,
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new PolicyError(
      `Invalid numeric scope value for root "${root}": ${value}. This is almost certainly a bug in the context function.`,
    )
  }
}

function stripScopeRelations(
  data: Record<string, unknown>,
  scopes: readonly { readonly fk: string; readonly root: string; readonly relationName: string }[],
): void {
  for (const scope of scopes) {
    delete data[scope.relationName]
  }
}

export function createScopeExtension<TRoots extends string>(
  scopeMap: ScopeMap,
  contextFn: () => Partial<Record<TRoots, string | number | bigint>>,
  guardConfig: GuardGeneratedConfig,
  logger?: GuardLogger,
) {
  const log: GuardLogger = logger ?? { warn: (msg) => console.warn(msg) }
  const findUniqueMode = guardConfig.findUniqueMode ?? 'verify'

  return {
    name: 'prisma-guard-scope',
    query: {
      $allOperations({ model, operation, args, query }: any) {
        if (!model || !scopeMap[model]) return query(args)

        const ctx = contextFn() as Partial<Record<string, string | number | bigint>>
        const scopes = scopeMap[model]

        const presentScopes = scopes.filter(s => ctx[s.root] != null)
        for (const s of presentScopes) {
          validateScopeValue(s.root, ctx[s.root])
        }

        const presentConditions = presentScopes.map(s => ({ [s.fk]: ctx[s.root] }))

        const missingRoots = scopes
          .filter(s => ctx[s.root] == null)
          .map(s => s.root)

        const isMutation = CREATE_OPS.has(operation) ||
          MUTATION_WITH_WHERE_OPS.has(operation) ||
          operation === 'upsert'

        if (missingRoots.length > 0) {
          if (isMutation || guardConfig.onMissingScopeContext === 'error') {
            throw new PolicyError(
              `Missing scope context for model "${model}": roots ${missingRoots.map(r => `"${r}"`).join(', ')} not provided. All scope roots must be present.`,
            )
          }
          if (guardConfig.onMissingScopeContext === 'warn') {
            log.warn(
              `prisma-guard: Missing scope context for model "${model}": roots ${missingRoots.map(r => `"${r}"`).join(', ')} not provided. Read proceeding with partial scope.`,
            )
          }
          if (presentConditions.length === 0) {
            return query(args)
          }
        }

        const conditions = presentConditions
        const overrides = Object.fromEntries(
          presentScopes.map(s => [s.fk, ctx[s.root]]),
        )

        if (operation === 'upsert') {
          throw new ShapeError(
            `Scoped model "${model}" cannot use upsert via extension. Handle upsert explicitly in route logic.`,
          )
        }

        if (FIND_UNIQUE_OPS.has(operation)) {
          if (findUniqueMode === 'reject') {
            throw new PolicyError(
              `Scoped model "${model}" does not allow ${operation} via scope extension (findUniqueMode is "reject"). Use findFirst with explicit where conditions instead.`,
            )
          }
          return handleFindUnique(args, query, conditions, scopes, operation)
        }

        const nextArgs = { ...args }

        if (READ_OPS.has(operation)) {
          nextArgs.where = buildAndConditions(args.where, conditions)
          return query(nextArgs)
        }

        if (AGGREGATE_OPS.has(operation)) {
          nextArgs.where = buildAndConditions(args.where, conditions)
          if (operation === 'groupBy' && !nextArgs.by) {
            throw new ShapeError(
              `prisma-guard: groupBy on scoped model "${model}" requires "by" argument.`,
            )
          }
          return query(nextArgs)
        }

        if (CREATE_OPS.has(operation)) {
          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            if (!Array.isArray(args.data)) {
              throw new ShapeError(`${operation} expects data to be an array`)
            }
            if (args.data.length === 0) {
              throw new ShapeError(`${operation} received empty data array`)
            }
            nextArgs.data = args.data.map((d: any) => {
              const item = { ...d, ...overrides }
              stripScopeRelations(item, scopes)
              return item
            })
          } else {
            if (args.data === undefined || args.data === null || typeof args.data !== 'object') {
              throw new ShapeError(`${operation} expects data to be an object`)
            }
            nextArgs.data = { ...args.data, ...overrides }
            stripScopeRelations(nextArgs.data, scopes)
          }
          return query(nextArgs)
        }

        if (MUTATION_WITH_WHERE_OPS.has(operation)) {
          nextArgs.where = buildAndConditions(args.where, conditions)
          if (args.data !== undefined && args.data !== null) {
            if (typeof args.data !== 'object' || Array.isArray(args.data)) {
              throw new ShapeError(`${operation} expects data to be an object`)
            }
            nextArgs.data = { ...args.data }
            for (const scope of scopes) {
              delete nextArgs.data[scope.fk]
            }
            stripScopeRelations(nextArgs.data, scopes)
          }
          return query(nextArgs)
        }

        throw new ShapeError(
          `Unknown operation "${operation}" on scoped model "${model}". Update prisma-guard to handle this operation.`,
        )
      },
    },
  }
}

async function handleFindUnique(
  args: any,
  query: (args: any) => Promise<any>,
  conditions: Record<string, unknown>[],
  scopes: readonly { readonly fk: string; readonly root: string; readonly relationName: string }[],
  operation: string,
): Promise<any> {
  const nextArgs = { ...args }
  const injectedFks: string[] = []
  const originalSelect = args?.select
  const fks = scopes.map(s => s.fk)

  if (originalSelect) {
    nextArgs.select = { ...originalSelect }
    for (const fk of fks) {
      if (!originalSelect[fk]) {
        nextArgs.select[fk] = true
        injectedFks.push(fk)
      }
    }
  }

  const result = await query(nextArgs)
  if (result === null) return result

  if (typeof result !== 'object' || result === null) {
    throw new ShapeError('findUnique result must be an object or null')
  }

  const resultObj = result as Record<string, unknown>

  let verifyObj: Record<string, unknown> = resultObj
  const missingFks = pickMissingFksFromResult(resultObj, fks)

  if (missingFks.length > 0) {
    const where = args?.where
    if (!where || typeof where !== 'object' || Array.isArray(where)) {
      throw new PolicyError(
        `prisma-guard: Cannot verify scope — missing FK fields (${missingFks.join(', ')}) and findUnique args.where is not a valid object.`,
      )
    }

    let verifyResult: any
    try {
      verifyResult = await query({ where, select: buildFkSelect(fks) })
    } catch (err: any) {
      throw new ShapeError(
        `prisma-guard: Scope verification query failed for findUnique: ${err?.message ?? String(err)}`,
        { cause: err },
      )
    }

    if (verifyResult === null) {
      throw new ShapeError('prisma-guard: Scope verification query returned null for an existing findUnique result')
    }
    if (typeof verifyResult !== 'object' || verifyResult === null) {
      throw new ShapeError('prisma-guard: Scope verification result must be an object')
    }

    verifyObj = verifyResult as Record<string, unknown>
  }

  for (const condition of conditions) {
    const [fk, value] = Object.entries(condition)[0]
    if (!(fk in verifyObj)) {
      throw new PolicyError(
        `prisma-guard: Cannot verify scope on "${fk}" — field not present in verification result. Ensure FK fields are selectable.`,
      )
    }
    if (!looseEqual(verifyObj[fk], value)) {
      if (operation === 'findUniqueOrThrow') {
        throw new PolicyError('Record not accessible in current scope')
      }
      return null
    }
  }

  if (injectedFks.length > 0) {
    const cleaned: Record<string, unknown> = { ...resultObj }
    for (const fk of injectedFks) {
      delete cleaned[fk]
    }
    return cleaned
  }

  return result
}