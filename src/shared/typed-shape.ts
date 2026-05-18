import type { OperationName, OperationShapeKey } from './operation-shape-keys.js'

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
}

export type TypeMapConst = Record<string, Record<string, FieldMetaConst>>

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

export type WritableFields<TM extends TypeMapConst, M extends keyof TM> = {
  [K in keyof TM[M]]: TM[M][K]['isRelation'] extends true
    ? never
    : TM[M][K]['isUpdatedAt'] extends true
      ? never
      : K
}[keyof TM[M]] & string

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

export type TypedNestedRelArgs<
  TM extends TypeMapConst,
  T,
  D extends ShapeDepth,
> = T extends keyof TM
  ? D extends 0
    ? LooseNestedArgs
    : {
        select?: TypedProjection<TM, T, DecDepth<D>>
        include?: TypedInclude<TM, T, DecDepth<D>>
        where?: TypedWhere<TM, T>
        orderBy?: true | Partial<Record<AllFields<TM, T>, unknown>>
        cursor?: Partial<Record<UniqueFields<TM, T>, true>>
        take?: number | { max: number; default?: number }
        skip?: true
      }
  : LooseNestedArgs

export type TypedProjection<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
> = {
  [K in AllFields<TM, M>]?: K extends RelationFields<TM, M>
    ? true | TypedNestedRelArgs<TM, RelTarget<TM, M, K>, D>
    : true
}

export type TypedInclude<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
> = {
  [K in RelationFields<TM, M>]?:
    true | TypedNestedRelArgs<TM, RelTarget<TM, M, K>, D>
}

export type TypedCountSelect<TM extends TypeMapConst, M extends keyof TM> =
  Partial<Record<ScalarFields<TM, M> | '_all', true>>

export type TypedCountField<TM extends TypeMapConst, M extends keyof TM> =
  true | Partial<Record<ScalarFields<TM, M> | '_all', true>>

export type TypedShapeProps<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
> = {
  where: TypedWhere<TM, M>
  select: TypedProjection<TM, M, D>
  include: TypedInclude<TM, M, D>
  orderBy: true | Partial<Record<AllFields<TM, M>, unknown>>
  cursor: Partial<Record<UniqueFields<TM, M>, true>>
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
  data: Partial<Record<WritableFields<TM, M>, unknown>>
  create: Partial<Record<WritableFields<TM, M>, unknown>>
  update: Partial<Record<WritableFields<TM, M>, unknown>>
}

type BaseOperationShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  O extends OperationName,
  D extends ShapeDepth,
> = Partial<Pick<
  TypedShapeProps<TM, M, D>,
  Extract<OperationShapeKey<O>, keyof TypedShapeProps<TM, M, D>>
>>

type RequireKeys<T, K extends keyof T> =
  Omit<T, K> & { [P in K]-?: NonNullable<T[P]> }

type CountShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth,
> = Omit<BaseOperationShape<TM, M, 'count', D>, 'select'> & {
  select?: TypedCountSelect<TM, M>
}

// Keep RequireKeys branches bound to concrete operation literals.
// If O stays a generic union here, keyof BaseOperationShape<..., O, ...>
// is deferred and TypeScript cannot prove that "where" or "by" is a key.
export type OperationShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  O extends OperationName,
  D extends ShapeDepth = 1,
> =
  O extends 'findUnique'
    ? RequireKeys<BaseOperationShape<TM, M, 'findUnique', D>, 'where'>
    : O extends 'findUniqueOrThrow'
      ? RequireKeys<BaseOperationShape<TM, M, 'findUniqueOrThrow', D>, 'where'>
      : O extends 'groupBy'
        ? RequireKeys<BaseOperationShape<TM, M, 'groupBy', D>, 'by'>
        : O extends 'count'
          ? CountShape<TM, M, D>
          : BaseOperationShape<TM, M, O, D>

export type TypedGuardShape<
  TM extends TypeMapConst,
  M extends keyof TM,
  D extends ShapeDepth = 1,
> = Partial<TypedShapeProps<TM, M, D>>

export type ShapeFn<S, TCtx> = (ctx: TCtx) => S

export type ShapeOrFn<S, TCtx> = S | ShapeFn<S, TCtx>

export type ShapeInput<S, TCtx = unknown> =
  Record<string, ShapeOrFn<S, TCtx>>