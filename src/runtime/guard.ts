import type {
  TypeMap, GuardConfig, InputOpts, ModelOpts,
  QueryMethod, ShapeOrFn, QuerySchema,
} from '../shared/types.js'
import { createSchemaBuilder } from './schema-builder.js'
import { createQueryBuilder } from './query-builder.js'
import { createScopeExtension } from './scope-extension.js'

export function createGuard<
  TModels extends TypeMap = TypeMap,
  TRoots extends string = string,
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
  )

  return {
    input: (model: MName, opts: InputOpts) =>
      schemaBuilder.buildInputSchema(model, opts),

    model: (model: MName, opts: ModelOpts) =>
      schemaBuilder.buildModelSchema(model, opts),

    query: <TCtx = unknown>(
      model: MName,
      method: QueryMethod,
      config: ShapeOrFn<TCtx> | Record<string, ShapeOrFn<TCtx>>,
    ): QuerySchema<TCtx> => queryBuilder.buildQuerySchema(model, method, config),

    extension: (contextFn: () => Partial<Record<TRoots, string | number | bigint>>) =>
      createScopeExtension<TRoots>(config.scopeMap, contextFn, config.guardConfig, config.logger),
  }
}