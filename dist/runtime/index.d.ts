import * as zod from 'zod';
import { z } from 'zod';
import * as zod_v4_core from 'zod/v4/core';

interface FieldMeta {
    type: string;
    isList: boolean;
    isRequired: boolean;
    isId: boolean;
    isRelation: boolean;
    hasDefault: boolean;
    isUpdatedAt: boolean;
    isEnum?: boolean;
}
interface GuardLogger {
    warn(message: string): void;
}
type InputOpts = {
    mode?: 'create' | 'update';
    partial?: boolean;
    allowNull?: boolean;
    refine?: Record<string, (field: z.ZodTypeAny) => z.ZodTypeAny>;
} & ({
    pick: string[];
    omit?: never;
} | {
    omit: string[];
    pick?: never;
} | {
    pick?: never;
    omit?: never;
});
interface ModelOpts {
    pick?: string[];
    omit?: string[];
    include?: Record<string, ModelOpts>;
    _count?: true | Record<string, true>;
    strict?: boolean;
    maxDepth?: number;
}
type QueryMethod = 'findMany' | 'findFirst' | 'findFirstOrThrow' | 'findUnique' | 'findUniqueOrThrow' | 'count' | 'aggregate' | 'groupBy';
interface ShapeConfig {
    where?: Record<string, Record<string, true | unknown>>;
    include?: Record<string, true | NestedIncludeArgs>;
    select?: Record<string, true | NestedSelectArgs>;
    orderBy?: Record<string, true>;
    cursor?: Record<string, true>;
    take?: {
        max: number;
        default: number;
    };
    skip?: true;
    distinct?: string[];
    _count?: true | Record<string, true>;
    _avg?: Record<string, true>;
    _sum?: Record<string, true>;
    _min?: Record<string, true>;
    _max?: Record<string, true>;
    by?: string[];
}
interface NestedIncludeArgs {
    where?: Record<string, Record<string, true | unknown>>;
    include?: Record<string, true | NestedIncludeArgs>;
    select?: Record<string, true | NestedSelectArgs>;
    orderBy?: Record<string, true>;
    cursor?: Record<string, true>;
    take?: {
        max: number;
        default: number;
    };
    skip?: true;
}
interface NestedSelectArgs {
    select?: Record<string, true | NestedSelectArgs>;
    where?: Record<string, Record<string, true | unknown>>;
    orderBy?: Record<string, true>;
    cursor?: Record<string, true>;
    take?: {
        max: number;
        default: number;
    };
    skip?: true;
}
type ShapeOrFn<TCtx = unknown> = ShapeConfig | ((ctx: TCtx) => ShapeConfig);
interface ScopeEntry {
    readonly fk: string;
    readonly root: string;
    readonly relationName: string;
}
type ScopeMap = Record<string, readonly ScopeEntry[]>;
type TypeMap = Record<string, Record<string, FieldMeta>>;
type EnumMap = Record<string, readonly string[]>;
type ZodChains = Record<string, Record<string, (base: any) => z.ZodTypeAny>>;
type MissingScopeContextMode = 'error' | 'warn' | 'ignore';
type FindUniqueMode = 'verify' | 'reject';
interface GuardGeneratedConfig {
    onMissingScopeContext: MissingScopeContextMode;
    findUniqueMode?: FindUniqueMode;
}
interface GuardConfig {
    scopeMap: ScopeMap;
    typeMap: TypeMap;
    enumMap: EnumMap;
    zodChains: ZodChains;
    guardConfig: GuardGeneratedConfig;
    logger?: GuardLogger;
}
interface QuerySchema<TCtx = unknown> {
    parse(body: unknown, opts?: {
        ctx?: TCtx;
    }): Record<string, unknown>;
    schemas: Partial<Record<string, z.ZodObject<any>>>;
}
interface InputSchema {
    parse(data: unknown): Record<string, unknown>;
    schema: z.ZodObject<any>;
}

declare function createGuard<TModels extends TypeMap = TypeMap, TRoots extends string = string>(config: GuardConfig & {
    typeMap: TModels;
}): {
    input: (model: Extract<keyof TModels, string>, opts: InputOpts) => InputSchema;
    model: (model: Extract<keyof TModels, string>, opts: ModelOpts) => zod.ZodObject<any, zod_v4_core.$strip>;
    query: <TCtx = unknown>(model: Extract<keyof TModels, string>, method: QueryMethod, config: ShapeOrFn<TCtx> | Record<string, ShapeOrFn<TCtx>>) => QuerySchema<TCtx>;
    extension: (contextFn: () => Partial<Record<TRoots, string | number | bigint>>) => {
        name: string;
        query: {
            $allOperations({ model, operation, args, query }: any): any;
        };
    };
};

declare class PolicyError extends Error {
    readonly status = 403;
    readonly code = "POLICY_DENIED";
    constructor(message?: string, options?: ErrorOptions);
}
declare class ShapeError extends Error {
    readonly status = 400;
    readonly code = "SHAPE_INVALID";
    constructor(message: string, options?: ErrorOptions);
}
declare class CallerError extends Error {
    readonly status = 400;
    readonly code = "CALLER_UNKNOWN";
    constructor(caller: string, options?: ErrorOptions);
}

export { CallerError, type EnumMap, type FieldMeta, type GuardConfig, type GuardGeneratedConfig, type GuardLogger, type InputOpts, type InputSchema, type MissingScopeContextMode, type ModelOpts, type NestedIncludeArgs, type NestedSelectArgs, PolicyError, type QueryMethod, type QuerySchema, type ScopeEntry, type ScopeMap, type ShapeConfig, ShapeError, type ShapeOrFn, type TypeMap, type ZodChains, createGuard };
