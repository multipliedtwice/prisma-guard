import type { z } from 'zod'

export interface FieldMeta {
  type: string
  isList: boolean
  isRequired: boolean
  isId: boolean
  isRelation: boolean
  hasDefault: boolean
  isUpdatedAt: boolean
  isEnum?: boolean
  isUnique?: boolean
}

export interface GuardLogger {
  warn(message: string): void
}

export type DataFieldRefine = (base: z.ZodTypeAny) => z.ZodTypeAny

export type InputOpts = {
  mode?: 'create' | 'update'
  partial?: boolean
  allowNull?: boolean
  refine?: Record<string, (field: z.ZodTypeAny) => z.ZodTypeAny>
} & (
  | { pick: string[]; omit?: never }
  | { omit: string[]; pick?: never }
  | { pick?: never; omit?: never }
)

export type ModelOpts = {
  include?: Record<string, ModelOpts>
  _count?: true | Record<string, true>
  strict?: boolean
  maxDepth?: number
} & (
  | { pick: string[]; omit?: never }
  | { omit: string[]; pick?: never }
  | { pick?: never; omit?: never }
)

export type QueryMethod =
  | 'findMany'
  | 'findFirst'
  | 'findFirstOrThrow'
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'count'
  | 'aggregate'
  | 'groupBy'

export type MutationMethod =
  | 'create'
  | 'createMany'
  | 'createManyAndReturn'
  | 'update'
  | 'updateMany'
  | 'updateManyAndReturn'
  | 'upsert'
  | 'delete'
  | 'deleteMany'

export type OrderByFieldConfig = true | Record<string, true>

export interface ShapeConfig {
  where?: Record<string, unknown>
  include?: Record<string, true | NestedIncludeArgs>
  select?: Record<string, true | NestedSelectArgs>
  orderBy?: true | Record<string, OrderByFieldConfig>
  cursor?: Record<string, true>
  take?: { max: number; default?: number }
  skip?: true
  distinct?: string[]
  _count?: true | Record<string, true>
  _avg?: Record<string, true>
  _sum?: Record<string, true>
  _min?: Record<string, true>
  _max?: Record<string, true>
  by?: string[]
  having?: Record<string, true>
}

export interface NestedIncludeArgs {
  where?: Record<string, unknown>
  include?: Record<string, true | NestedIncludeArgs>
  select?: Record<string, true | NestedSelectArgs>
  orderBy?: Record<string, OrderByFieldConfig>
  cursor?: Record<string, true>
  take?: { max: number; default?: number }
  skip?: true
}

export interface NestedSelectArgs {
  select?: Record<string, true | NestedSelectArgs>
  where?: Record<string, unknown>
  orderBy?: Record<string, OrderByFieldConfig>
  cursor?: Record<string, true>
  take?: { max: number; default?: number }
  skip?: true
}

export type ShapeOrFn<TCtx = unknown> =
  | ShapeConfig
  | ((ctx: TCtx) => ShapeConfig)

export interface ScopeEntry {
  readonly fk: string
  readonly root: string
  readonly relationName: string
}

export type ScopeMap = Record<string, readonly ScopeEntry[]>
export type TypeMap = Record<string, Record<string, FieldMeta>>
export type EnumMap = Record<string, readonly string[]>
export type ZodChains = Record<string, Record<string, (base: any) => z.ZodTypeAny>>
export type ZodDefaults = Record<string, readonly string[]>
export type UniqueConstraint = readonly string[]
export type UniqueMap = Record<string, readonly UniqueConstraint[]>

export type MissingScopeContextMode = 'error' | 'warn' | 'ignore'
export type FindUniqueMode = 'verify' | 'reject'
export type OnScopeRelationWrite = 'error' | 'warn' | 'strip'

export interface GuardGeneratedConfig {
  onMissingScopeContext: MissingScopeContextMode
  findUniqueMode?: FindUniqueMode
  onScopeRelationWrite?: OnScopeRelationWrite
  strictDecimal?: boolean
  enforceProjection?: boolean
}

export interface GuardConfig {
  scopeMap: ScopeMap
  typeMap: TypeMap
  enumMap: EnumMap
  zodChains: ZodChains
  guardConfig: GuardGeneratedConfig
  uniqueMap?: UniqueMap
  zodDefaults?: ZodDefaults
  logger?: GuardLogger
  wrapZodErrors?: boolean
}

export interface QuerySchema<TCtx = unknown> {
  parse(body: unknown, opts?: { ctx?: TCtx; caller?: string }): Record<string, unknown>
  schemas: Partial<Record<string, z.ZodObject<any>>>
}

export interface InputSchema {
  parse(data: unknown): Record<string, unknown>
  schema: z.ZodObject<any>
}

export interface GuardShape extends ShapeConfig {
  data?: Record<string, true | DataFieldRefine | unknown>
  create?: Record<string, true | DataFieldRefine | unknown>
  update?: Record<string, true | DataFieldRefine | unknown>
}

export type GuardShapeOrFn =
  | GuardShape
  | ((ctx: any) => GuardShape)

export type GuardInput =
  | GuardShapeOrFn
  | Record<string, GuardShapeOrFn>

type GuardableMethodName = QueryMethod | MutationMethod

type ExtractReturn<T, K extends string> =
  K extends keyof T
    ? T[K] extends (...args: any[]) => infer R ? R : never
    : never

export type GuardedModel<TDelegate> = {
  [K in GuardableMethodName as K extends keyof TDelegate ? K : never]:
    ExtractReturn<TDelegate, K> extends never
      ? never
      : (body: unknown) => ExtractReturn<TDelegate, K>
}