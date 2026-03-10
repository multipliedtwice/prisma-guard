import { ZodError } from 'zod'
import type {
  TypeMap, GuardConfig, InputOpts, ModelOpts,
  QueryMethod, ShapeOrFn, QuerySchema, GuardLogger,
} from '../shared/types.js'
import { ShapeError, PolicyError, formatZodError } from '../shared/errors.js'
import { createScalarBase } from '../shared/scalar-base.js'
import { createSchemaBuilder } from './schema-builder.js'
import { createQueryBuilder } from './query-builder.js'
import { createScopeExtension } from './scope-extension.js'
import { createModelGuardExtension } from './model-guard.js'
import { validateContext } from './policy.js'

export function createGuard<
  TModels extends TypeMap = TypeMap,
  TRoots extends string = string,
  TModelExt = unknown,
>(
  config: GuardConfig & { typeMap: TModels },
) {
  type MName = Extract<keyof TModels, string>

  const scalarBase = createScalarBase(config.guardConfig.strictDecimal ?? false)

  const schemaBuilder = createSchemaBuilder(
    config.typeMap,
    config.zodChains,
    config.enumMap,
    scalarBase,
    config.zodDefaults ?? {},
  )
  const queryBuilder = createQueryBuilder(
    config.typeMap,
    config.enumMap,
    config.uniqueMap ?? {},
    scalarBase,
  )

  const log: GuardLogger = config.logger ?? { warn: (msg) => console.warn(msg) }
  const wrapZodErrors = config.wrapZodErrors ?? false

  function rethrowZod(err: unknown): never {
    if (err instanceof ZodError) {
      throw new ShapeError(`Validation failed: ${formatZodError(err)}`, { cause: err })
    }
    throw err
  }

  return {
    input: (model: MName, opts: InputOpts) => {
      const result = schemaBuilder.buildInputSchema(model, opts)
      if (!wrapZodErrors) return result
      return {
        schema: result.schema,
        parse(data: unknown): Record<string, unknown> {
          try {
            return result.parse(data)
          } catch (err) {
            rethrowZod(err)
          }
        },
      }
    },

    model: (model: MName, opts: ModelOpts) =>
      schemaBuilder.buildModelSchema(model, opts),

    query: <TCtx = unknown>(
      model: MName,
      method: QueryMethod,
      config_: ShapeOrFn<TCtx> | Record<string, ShapeOrFn<TCtx>>,
    ): QuerySchema<TCtx> => {
      const qs = queryBuilder.buildQuerySchema(model, method, config_)
      if (!wrapZodErrors) return qs
      return {
        schemas: qs.schemas,
        parse(body: unknown, opts?: { ctx?: TCtx }): Record<string, unknown> {
          try {
            return qs.parse(body, opts)
          } catch (err) {
            rethrowZod(err)
          }
        },
      }
    },

    extension: <TCtx extends Record<string, unknown> = Record<string, unknown>>(
      contextFn: () => TCtx,
    ) => {
      const scopeRoots = new Set<string>()
      for (const entries of Object.values(config.scopeMap)) {
        for (const entry of entries) {
          scopeRoots.add(entry.root)
        }
      }

      const scopeCtxFn = () => {
        const ctx = validateContext(contextFn())
        const scopeCtx: Partial<Record<TRoots, string | number | bigint>> = {}
        for (const key of Object.keys(ctx)) {
          if (!scopeRoots.has(key)) continue
          const val = ctx[key]
          if (typeof val === 'string' || typeof val === 'number' || typeof val === 'bigint') {
            scopeCtx[key as TRoots] = val
          } else if (val !== null && val !== undefined) {
            throw new PolicyError(
              `prisma-guard: Scope root "${key}" has non-primitive value (${typeof val}). Only string, number, and bigint values are accepted for scope context.`,
            )
          }
        }
        return scopeCtx
      }

      const scopeExt = createScopeExtension<TRoots>(
        config.scopeMap,
        scopeCtxFn,
        config.guardConfig,
        config.logger,
      )

      const modelGuardExt = createModelGuardExtension({
        typeMap: config.typeMap,
        enumMap: config.enumMap,
        zodChains: config.zodChains,
        zodDefaults: config.zodDefaults ?? {},
        uniqueMap: config.uniqueMap ?? {},
        scopeMap: config.scopeMap,
        guardConfig: config.guardConfig,
        contextFn,
        wrapZodErrors,
      })

      return {
        name: 'prisma-guard',
        model: modelGuardExt as unknown as TModelExt,
        query: scopeExt.query,
      }
    },
  }
}