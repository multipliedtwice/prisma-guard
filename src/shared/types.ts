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
}

export interface GuardLogger {
  warn(message: string): void
}

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

export interface ModelOpts {
  pick?: string[]
  omit?: string[]
  include?: Record<string, ModelOpts>
  _count?: true | Record<string, true>
  strict?: boolean
  maxDepth?: number
}

export type QueryMethod =
  | 'findMany'
  | 'findFirst'
  | 'findFirstOrThrow'
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'count'
  | 'aggregate'
  | 'groupBy'

export interface ShapeConfig {
  where?: Record<string, Record<string, true | unknown>>
  include?: Record<string, true | NestedIncludeArgs>
  select?: Record<string, true | NestedSelectArgs>
  orderBy?: Record<string, true>
  cursor?: Record<string, true>
  take?: { max: number; default: number }
  skip?: true
  distinct?: string[]
  _count?: true | Record<string, true>
  _avg?: Record<string, true>
  _sum?: Record<string, true>
  _min?: Record<string, true>
  _max?: Record<string, true>
  by?: string[]
}

export interface NestedIncludeArgs {
  where?: Record<string, Record<string, true | unknown>>
  include?: Record<string, true | NestedIncludeArgs>
  select?: Record<string, true | NestedSelectArgs>
  orderBy?: Record<string, true>
  cursor?: Record<string, true>
  take?: { max: number; default: number }
  skip?: true
}

export interface NestedSelectArgs {
  select?: Record<string, true | NestedSelectArgs>
  where?: Record<string, Record<string, true | unknown>>
  orderBy?: Record<string, true>
  cursor?: Record<string, true>
  take?: { max: number; default: number }
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

export type MissingScopeContextMode = 'error' | 'warn' | 'ignore'
export type FindUniqueMode = 'verify' | 'reject'

export interface GuardGeneratedConfig {
  onMissingScopeContext: MissingScopeContextMode
  findUniqueMode?: FindUniqueMode
}

export interface GuardConfig {
  scopeMap: ScopeMap
  typeMap: TypeMap
  enumMap: EnumMap
  zodChains: ZodChains
  guardConfig: GuardGeneratedConfig
  logger?: GuardLogger
}

export interface QuerySchema<TCtx = unknown> {
  parse(body: unknown, opts?: { ctx?: TCtx }): Record<string, unknown>
  schemas: Partial<Record<string, z.ZodObject<any>>>
}

export interface InputSchema {
  parse(data: unknown): Record<string, unknown>
  schema: z.ZodObject<any>
}