import type {
  OperationName,
  OperationShapeKey,
} from './operation-shape-keys.js'

export interface FieldMetaConst {
  readonly type: string
  readonly isList: boolean
  readonly isRequired: boolean
  readonly isId: boolean
  readonly isRelation: boolean
  readonly hasDefault: boolean
  readonly isUpdatedAt: boolean
  readonly isEnum?: boolean
  readonly isUnique?: boolean
  readonly isUnsupported?: boolean
  readonly relationFromFields?: readonly string[]
}

export interface UniqueConstraintConst {
  readonly selector: string
  readonly fields: readonly string[]
}

export type TypeMapConst = Record<string, Record<string, FieldMetaConst>>

export type UniqueMapConst = Record<string, readonly UniqueConstraintConst[]>

export type ShapeDepth = 0 | 1 | 2 | 3

export type DecDepth<D extends ShapeDepth> =
  D extends 3 ? 2 : D extends 2 ? 1 : D extends 1 ? 0 : 0

export type ModelName<TM extends TypeMapConst> = keyof TM & string

export type AllFields<TM extends TypeMapConst, M extends keyof TM> =
  keyof TM[M] & string

export type ScalarFields<TM extends TypeMapConst, M extends keyof TM> = {
  [K in keyof TM[M]]: TM[M][K]['isRelation'] extends true ? never : K
}[keyof TM[M]] & string

export type RelationFields<TM extends TypeMapConst, M extends keyof TM> = {
  [K in keyof TM[M]]: TM[M][K]['isRelation'] extends true ? K : never
}[keyof TM[M]] & string

export type ListRelationFields<TM extends TypeMapConst, M extends keyof TM> = {
  [K in keyof TM[M]]: TM[M][K]['isRelation'] extends true
    ? TM[M][K]['isList'] extends true
      ? K
      : never
    : never
}[keyof TM[M]] & string

export type WritableScalarFields<TM extends TypeMapConst, M extends keyof TM> = {
  [K in keyof TM[M]]: TM[M][K]['isRelation'] extends true
    ? never
    : TM[M][K]['isUpdatedAt'] extends true
      ? never
      : K
}[keyof TM[M]] & string

export type WritableFields<TM extends TypeMapConst, M extends keyof TM> =
  WritableScalarFields<TM, M> | RelationFields<TM, M>

export type UniqueFields<TM extends TypeMapConst, M extends keyof TM> = {
  [K in keyof TM[M]]: TM[M][K]['isUnique'] extends true
    ? K
    : TM[M][K]['isId'] extends true
      ? K
      : never
}[keyof TM[M]] & string

type NumericScalarType = 'Int' | 'BigInt' | 'Float' | 'Decimal'
type ComparableScalarType = NumericScalarType | 'String' | 'DateTime'

export type NumericFields<TM extends TypeMapConst, M extends keyof TM> = {
  [K in keyof TM[M]]: TM[M][K]['isRelation'] extends true
    ? never
    : TM[M][K]['type'] extends NumericScalarType
      ? K
      : never
}[keyof TM[M]] & string

export type ComparableFields<TM extends TypeMapConst, M extends keyof TM> = {
  [K in keyof TM[M]]: TM[M][K]['isRelation'] extends true
    ? never
    : TM[M][K]['type'] extends ComparableScalarType
      ? K
      : never
}[keyof TM[M]] & string

export type RelTarget<
  TM extends TypeMapConst,
  M extends keyof TM,
  K extends keyof TM[M],
> = TM[M][K]['type'] extends string
  ? Extract<keyof TM, TM[M][K]['type']>
  : never

export type LooseNestedArgs = {
  select?: Record<string, unknown>
  include?: Record<string, unknown>
  where?: Record<string, unknown>
  orderBy?: Record<string, unknown>
  cursor?: Record<string, unknown>
  take?: number | { max: number; default?: number }
  skip?: true
}

export type TypedWhere<TM extends TypeMapConst, M extends keyof TM> =
  Partial<Record<AllFields<TM, M> | 'AND' | 'OR' | 'NOT', unknown>>

type ForcedShapeValue<T> = { value: T }

type UniqueScalarValue<F extends FieldMetaConst> =
  F['isEnum'] extends true
    ? string
    : F['type'] extends 'String'
      ? string
      : F['type'] extends 'Int'
        ? number
        : F['type'] extends 'BigInt'
          ? bigint | number | string
          : F['type'] extends 'Float'
            ? number
            : F['type'] extends 'Decimal'
              ? number | string
              : F['type'] extends 'Boolean'
                ? boolean
                : F['type'] extends 'DateTime'
                  ? Date | string
                  : F['type'] extends 'Bytes'
                    ? Uint8Array | string
                    : string | number | bigint | boolean | Date | Uint8Array

export type TypedUniqueWhereValue<F extends FieldMetaConst> =
  | true
  | UniqueScalarValue<F>
  | ForcedShapeValue<UniqueScalarValue<F>>

type SingleFieldUniqueWhere<
  TM extends TypeMapConst,
  M extends keyof TM,
> = Partial<{
  [K in UniqueFields<TM, M>]: TypedUniqueWhereValue<TM[M][K]>
}>

type ModelUniqueConstraints<
  TM extends TypeMapConst,
  M extends keyof TM,
  UM extends UniqueMapConst,
> = M extends keyof UM ? UM[M][number] : never

type UniqueSelectorNames<
  TM extends TypeMapConst,
  M extends keyof TM,
  UM extends UniqueMapConst,
> = ModelUniqueConstraints<TM, M, UM> extends infer C
  ? C extends UniqueConstraintConst
    ? C['selector'] & string
    : never
  : never

type UniqueConstraintBySelector<
  TM extends TypeMapConst,
  M extends keyof TM,
  UM extends UniqueMapConst,
  S extends string,
> = Extract<ModelUniqueConstraints<TM, M, UM>, { readonly selector: S }>

type UniqueFieldName<
  TM extends TypeMapConst,
  M extends keyof TM,
  F,
> = Extract<F, keyof TM[M] & string>

type TypedCompoundUniqueSelector<
  TM extends TypeMapConst,
  M extends keyof TM,
  C extends UniqueConstraintConst,
> = {
  [K in UniqueFieldName<TM, M, C['fields'][number]>]:
    TypedUniqueWhereValue<TM[M][K]>
}

type TypedCompoundUniqueForcedValue<
  TM extends TypeMapConst,
  M extends keyof TM,
  C extends UniqueConstraintConst,
> = {
  [K in UniqueFieldName<TM, M, C['fields'][number]>]:
    UniqueScalarValue<TM[M][K]>
}

type TypedUniqueSelectorValue<
  TM extends TypeMapConst,
  M extends keyof TM,
  C extends UniqueConstraintConst,
> =
  C['fields'] extends readonly [infer F]
    ? TypedUniqueWhereValue<TM[M][UniqueFieldName<TM, M, F>]>
    :
        | TypedCompoundUniqueSelector<TM, M, C>
        | ForcedShapeValue<TypedCompoundUniqueForcedValue<TM, M, C>>

type GeneratedUniqueWhere<
  TM extends TypeMapConst,
  M extends keyof TM,
  UM extends UniqueMapConst,
> = Partial<{
  [S in UniqueSelectorNames<TM, M, UM>]:
    TypedUniqueSelectorValue<
      TM,
      M,
      UniqueConstraintBySelector<TM, M, UM, S>
    >
}>

export type TypedUniqueWhere<
  TM extends TypeMapConst,
  M extends keyof TM,
  UM extends UniqueMapConst = {},
> = SingleFieldUniqueWhere<TM, M> & GeneratedUniqueWhere<TM, M, UM>

export type TypedCountSelectInProjection<
  TM extends TypeMapConst,
  M extends keyof TM,
> = {
  [K in ListRelationFields<TM, M>]?:
    | true
    | { where?: TypedWhere<TM, RelTarget<TM, M, K>> }
}

export type TypedProjectionCount<
  TM extends TypeMapConst,
  M extends keyof TM,
> = true | { select: TypedCountSelectInProjection<TM, M> }

export type TypedNestedRelArgs<
  TM extends TypeMapConst,
  T,
  D extends ShapeDepth,
  UM extends UniqueMapConst = {},
> = T extends keyof TM
  ? D extends 0
    ? LooseNestedArgs
    : {
        select?: TypedProjection<TM, T, DecDepth<D>, UM>
        include?: TypedInclude<TM, T, DecDepth<D>, UM>
        where?: TypedWhere<TM, T>
        orderBy?: true | Partial<Record<AllFields<TM, T>, unknown>>
        cursor?: TypedUniqueWhere<TM, T, UM>
        take?: number | { max: number; default?: number }
        skip?: true
      }
  : LooseNestedArgs

export type TypedProjection<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst = {},
> = {
  [K in AllFields<TM, M>]?: K extends RelationFields<TM, M>
    ? true | TypedNestedRelArgs<TM, RelTarget<TM, M, K>, D, UM>
    : true
} & {
  _count?: TypedProjectionCount<TM, M>
}

export type TypedInclude<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst = {},
> = {
  [K in RelationFields<TM, M>]?:
    | true
    | TypedNestedRelArgs<TM, RelTarget<TM, M, K>, D, UM>
} & {
  _count?: TypedProjectionCount<TM, M>
}

export type TypedCountSelect<TM extends TypeMapConst, M extends keyof TM> =
  Partial<Record<ScalarFields<TM, M> | '_all', true>>

export type TypedCountField<TM extends TypeMapConst, M extends keyof TM> =
  true | Partial<Record<ScalarFields<TM, M> | '_all', true>>

export interface TypedRelationWriteConfig {
  connect?: unknown
  connectOrCreate?: unknown
  create?: unknown
  createMany?: unknown
  disconnect?: unknown
  delete?: unknown
  set?: unknown
  update?: unknown
  updateMany?: unknown
  upsert?: unknown
  deleteMany?: unknown
}

type WritableFieldValue<
  TM extends TypeMapConst,
  M extends keyof TM,
  K extends keyof TM[M],
> = TM[M][K]['isRelation'] extends true
  ? TypedRelationWriteConfig
  : unknown

export type TypedDataShape<
  TM extends TypeMapConst,
  M extends keyof TM,
> = Partial<{
  [K in WritableFields<TM, M>]: WritableFieldValue<TM, M, K>
}>

export type TypedShapeProps<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst = {},
> = {
  where: TypedWhere<TM, M>
  select: TypedProjection<TM, M, D, UM>
  include: TypedInclude<TM, M, D, UM>
  orderBy: true | Partial<Record<AllFields<TM, M>, unknown>>
  cursor: TypedUniqueWhere<TM, M, UM>
  take: number | { max: number; default?: number }
  skip: true
  distinct: ScalarFields<TM, M>[]
  by: ScalarFields<TM, M>[]
  having: Partial<Record<ScalarFields<TM, M>, unknown>>
  _count: TypedCountField<TM, M>
  _avg: Partial<Record<NumericFields<TM, M>, true>>
  _sum: Partial<Record<NumericFields<TM, M>, true>>
  _min: Partial<Record<ComparableFields<TM, M>, true>>
  _max: Partial<Record<ComparableFields<TM, M>, true>>
  data: TypedDataShape<TM, M>
  create: TypedDataShape<TM, M>
  update: TypedDataShape<TM, M>
}

type BaseOperationShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  O extends OperationName,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Partial<
  Pick<
    TypedShapeProps<TM, M, D, UM>,
    Extract<OperationShapeKey<O>, keyof TypedShapeProps<TM, M, D, UM>>
  >
>

type RequireKeys<T, K extends keyof T> =
  Omit<T, K> & { [P in K]-?: NonNullable<T[P]> }

type CountShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, 'count', D, UM>, 'select'> & {
  select?: TypedCountSelect<TM, M>
}

type WithUniqueWhereOptional<
  TM extends TypeMapConst,
  M extends keyof TM,
  O extends OperationName,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, O, D, UM>, 'where'> & {
  where?: TypedUniqueWhere<TM, M, UM>
}

type WithUniqueWhereRequired<
  TM extends TypeMapConst,
  M extends keyof TM,
  O extends OperationName,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, O, D, UM>, 'where'> & {
  where: TypedUniqueWhere<TM, M, UM>
}

type RequiredUpdateShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, 'update', D, UM>, 'where' | 'data'> & {
  where: TypedUniqueWhere<TM, M, UM>
  data: TypedDataShape<TM, M>
}

type RequiredUpsertShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, 'upsert', D, UM>, 'where' | 'create' | 'update'> & {
  where: TypedUniqueWhere<TM, M, UM>
  create: TypedDataShape<TM, M>
  update: TypedDataShape<TM, M>
}

type RequiredCreateShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, 'create', D, UM>, 'data'> & {
  data: TypedDataShape<TM, M>
}

type RequiredCreateManyShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, 'createMany', D, UM>, 'data'> & {
  data: TypedDataShape<TM, M>
}

type RequiredCreateManyAndReturnShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, 'createManyAndReturn', D, UM>, 'data'> & {
  data: TypedDataShape<TM, M>
}

type RequiredUpdateManyShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, 'updateMany', D, UM>, 'data' | 'where'> & {
  data: TypedDataShape<TM, M>
  where: TypedWhere<TM, M>
}

type RequiredUpdateManyAndReturnShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<
  BaseOperationShape<TM, M, 'updateManyAndReturn', D, UM>,
  'data' | 'where'
> & {
  data: TypedDataShape<TM, M>
  where: TypedWhere<TM, M>
}

type RequiredDeleteManyShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
  UM extends UniqueMapConst,
> = Omit<BaseOperationShape<TM, M, 'deleteMany', D, UM>, 'where'> & {
  where: TypedWhere<TM, M>
}

export type OperationShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  O extends OperationName,
  D extends ShapeDepth = 1,
  UM extends UniqueMapConst = {},
> =
  O extends 'findUnique'
    ? WithUniqueWhereRequired<TM, M, 'findUnique', D, UM>
    : O extends 'findUniqueOrThrow'
      ? WithUniqueWhereRequired<TM, M, 'findUniqueOrThrow', D, UM>
      : O extends 'update'
        ? RequiredUpdateShape<TM, M, D, UM>
        : O extends 'delete'
          ? WithUniqueWhereRequired<TM, M, 'delete', D, UM>
          : O extends 'upsert'
            ? RequiredUpsertShape<TM, M, D, UM>
            : O extends 'create'
              ? RequiredCreateShape<TM, M, D, UM>
              : O extends 'createMany'
                ? RequiredCreateManyShape<TM, M, D, UM>
                : O extends 'createManyAndReturn'
                  ? RequiredCreateManyAndReturnShape<TM, M, D, UM>
                  : O extends 'updateMany'
                    ? RequiredUpdateManyShape<TM, M, D, UM>
                    : O extends 'updateManyAndReturn'
                      ? RequiredUpdateManyAndReturnShape<TM, M, D, UM>
                      : O extends 'deleteMany'
                        ? RequiredDeleteManyShape<TM, M, D, UM>
                        : O extends 'groupBy'
                          ? RequireKeys<BaseOperationShape<TM, M, 'groupBy', D, UM>, 'by'>
                          : O extends 'count'
                            ? CountShape<TM, M, D, UM>
                            : BaseOperationShape<TM, M, O, D, UM>

export type TypedGuardShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth = 1,
  UM extends UniqueMapConst = {},
> = Partial<TypedShapeProps<TM, M, D, UM>>

export type ShapeFn<S, TCtx> = (ctx: TCtx) => S

export type ShapeOrFn<S, TCtx> = S | ShapeFn<S, TCtx>

export type ShapeInput<S, TCtx = unknown> =
  | ShapeOrFn<S, TCtx>
  | Record<string, ShapeOrFn<S, TCtx>>