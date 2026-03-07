import type {
  TypeMap, GuardConfig, InputOpts, ModelOpts,
  QueryMethod, ShapeOrFn, QuerySchema, GuardLogger,
} from '../shared/types.js'
import { createSchemaBuilder } from './schema-builder.js'
import { createQueryBuilder } from './query-builder.js'
import { createScopeExtension } from './scope-extension.js'
import { createModelGuardExtension } from './model-guard.js'

export function createGuard<
  TModels extends TypeMap = TypeMap,
  TRoots extends string = string,
  TModelExt = unknown,
>(
  config: GuardConfig & { typeMap: TModels },
) {
  type MName = Extract<keyof TModels, string>

  const schemaBuilder = createSchemaBuilder(
    config.typeMap,
    config.zodChains,
    config.enumMap,
  )
  const queryBuilder = createQueryBuilder(
    config.typeMap,
    config.enumMap,
    config.uniqueMap ?? {},
  )

  const log: GuardLogger = config.logger ?? { warn: (msg) => console.warn(msg) }

  return {
    input: (model: MName, opts: InputOpts) =>
      schemaBuilder.buildInputSchema(model, opts),

    model: (model: MName, opts: ModelOpts) =>
      schemaBuilder.buildModelSchema(model, opts),

    query: <TCtx = unknown>(
      model: MName,
      method: QueryMethod,
      config_: ShapeOrFn<TCtx> | Record<string, ShapeOrFn<TCtx>>,
    ): QuerySchema<TCtx> => queryBuilder.buildQuerySchema(model, method, config_),

    extension: <TCtx extends Record<string, unknown> = Record<string, unknown>>(
      contextFn: () => TCtx,
    ) => {
      const scopeCtxFn = () => {
        const ctx = contextFn()
        const scopeCtx: Partial<Record<TRoots, string | number | bigint>> = {}
        for (const key of Object.keys(ctx)) {
          const val = ctx[key]
          if (typeof val === 'string' || typeof val === 'number' || typeof val === 'bigint') {
            scopeCtx[key as TRoots] = val
          } else if (val !== null && val !== undefined) {
            log.warn(
              `prisma-guard: Context key "${key}" has non-primitive value (${typeof val}). Only string, number, and bigint values are used for scope context.`,
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
        uniqueMap: config.uniqueMap ?? {},
        scopeMap: config.scopeMap,
        contextFn,
      })

      return {
        name: 'prisma-guard',
        model: modelGuardExt as unknown as TModelExt,
        query: scopeExt.query,
      }
    },
  }
}