## prisma-guard — Final Implementation Plan

### What this is

`prisma-guard` is a Prisma generator and runtime library that controls what goes in and out of Prisma in RPC-style backends. It solves three problems from one DMMF source: input validation (typed zod schemas with constraints from the Prisma schema), query shape enforcement (whitelisting which fields can be filtered, included, ordered, and how deep), and row-level tenant isolation (automatic scope injection via Prisma extension). Existing solutions either generate everything and create circular dependency bloat, or only address one of these concerns. prisma-guard generates nothing until explicitly asked, never auto-follows relations, and composes validation, shape boundaries, and tenancy into a single coherent API.

Role-based access control (who can access which endpoints, which fields are visible per role) is explicitly out of scope. Use [prisma-rbac](https://github.com/multipliedtwice/prisma-rbac) or equivalent middleware for RBAC. prisma-guard handles what data looks like and which tenant owns it, not who is allowed to touch it.

The library uses a two-layer approach to tenant isolation. Simple models with a single unambiguous FK to a scope root are automatically protected by the Prisma extension. Complex models (multiple FKs to the same root, indirect relations, role-based access) are handled explicitly via `guard.query()` with forced literal values in the shape config. Neither layer alone covers every schema — together they provide complete coverage.

Query shapes use Prisma-native syntax. `true` means "client controls this value." Any other value means "server forces this value." This eliminates the need for a separate DSL — the shape IS the Prisma args boundary.

---

### Package structure

```
prisma-guard/
├── src/
│   ├── generator/
│   │   ├── index.ts
│   │   ├── emit-scope-map.ts
│   │   ├── emit-zod-chains.ts
│   │   ├── emit-type-map.ts
│   │   └── validate-directive.ts
│   ├── runtime/
│   │   ├── index.ts
│   │   ├── guard.ts
│   │   ├── schema-builder.ts
│   │   ├── query-builder.ts
│   │   ├── policy.ts
│   │   ├── scope-extension.ts
│   │   └── zod-type-map.ts
│   └── shared/
│       ├── types.ts
│       └── errors.ts
├── tests/
├── tsup.config.ts
└── package.json
```

```json
{
  "exports": {
    "./generator": "./dist/generator/index.js",
    ".": "./dist/runtime/index.js"
  },
  "bin": {
    "prisma-guard": "./dist/generator/index.js"
  },
  "dependencies": {
    "@prisma/generator-helper": "^5.0.0 || ^6.0.0"
  },
  "peerDependencies": {
    "zod": "^3.22.0",
    "@prisma/client": "^5.0.0 || ^6.0.0"
  }
}
```

`tsup.config.ts` preserves shebang for the generator entrypoint via `banner: { js: '#!/usr/bin/env node' }`.

---

### Generated output

Single file. Generator registered in schema:

```prisma
generator guard {
  provider                = "prisma-guard"
  output                  = "generated/guard"
  onInvalidZod            = "error"    // "error" (default) | "warn"
  onAmbiguousScope        = "error"    // "error" (default) | "warn" | "ignore"
  onMissingScopeContext   = "error"    // "error" (default) | "warn" | "ignore"
}
```

Consumer's `tsconfig.json` must include the generator output directory.

Emits `generated/guard/index.ts`. All map keys use exact PascalCase DMMF model names:

```ts
import { z } from 'zod'

export const GUARD_CONFIG = {
  onMissingScopeContext: 'error',
} as const

export const SCOPE_MAP = {
  CompanyHiringStep: [{ fk: 'companyId', root: 'Company' }],
  CompanyOnUser: [{ fk: 'companyId', root: 'Company' }, { fk: 'userId', root: 'User' }],
  JobDescription: [{ fk: 'clientCompanyId', root: 'Company' }],
  TalentInvitation: [{ fk: 'companyId', root: 'Company' }],
} as const

export const TYPE_MAP = {
  User: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    email: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    displayName: { type: 'String', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
} as const

export const ENUM_MAP = {
  BILLING_STATUS: ['DRAFT', 'SENT', 'APPROVED', 'INVOICED', 'PAID', 'REJECTED'],
  WORK_MODE: ['remote', 'hybrid', 'onsite'],
  ASSIGNMENT_TYPE: ['fulltime', 'parttime', 'ondemand'],
  VERIFICATION_STATUS: ['verified', 'pending', 'rejected', 'deleted'],
  TRANSACTION_TYPES: ['SALARY', 'COMISSION', 'MISC', 'WITHDRAWAL'],
  RATE_UNIT: ['hour', 'day', 'week', 'month', 'project'],
} as const

export type ModelName = keyof typeof TYPE_MAP
export type FieldName<M extends ModelName> = keyof (typeof TYPE_MAP)[M]
export type ScopeRoot = 'Company' | 'User'

export const ZOD_CHAINS = {
  User: {
    email: (base: any) => base.email().max(255),
  },
}
```

The `import { z } from 'zod'` line is only emitted if `ZOD_CHAINS` has at least one entry. `GUARD_CONFIG`, `ModelName`, `FieldName`, and `ScopeRoot` type exports are always emitted. `ScopeRoot` is `never` if no scope roots exist. Generator throws at generation time if any enum has zero values.

Models with ambiguous multi-FK (like `jobAssignment` with `salesCompanyId`, `providerCompanyId`, `clientCompanyId` all referencing `company`) are excluded from `SCOPE_MAP` when `onAmbiguousScope` is `"error"` (default). These models are handled via `guard.query()` with forced literal values in the shape config instead.

---

### Shared: `types.ts`

All interfaces and types are exported.

```ts
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
  strict?: boolean
}

export type QueryMethod =
  | 'findMany'
  | 'findFirst'
  | 'findFirstOrThrow'
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'count'

export interface ShapeConfig {
  where?: Record<string, Record<string, true | unknown>>
  include?: Record<string, true | NestedIncludeArgs>
  select?: Record<string, true | NestedSelectArgs>
  orderBy?: Record<string, true>
  take?: { max: number; default: number }
  skip?: boolean
}

export interface NestedIncludeArgs {
  where?: Record<string, Record<string, true | unknown>>
  include?: Record<string, true | NestedIncludeArgs>
  orderBy?: Record<string, true>
  take?: { max: number; default: number }
  skip?: boolean
}

export interface NestedSelectArgs {
  select?: Record<string, true | NestedSelectArgs>
  where?: Record<string, Record<string, true | unknown>>
  orderBy?: Record<string, true>
  take?: { max: number; default: number }
  skip?: boolean
}

export type ShapeOrFn<TCtx = unknown> =
  | ShapeConfig
  | ((ctx: TCtx) => ShapeConfig)

export interface ScopeEntry {
  fk: string
  root: string
}

export type ScopeMap = Record<string, ScopeEntry[]>
export type TypeMap = Record<string, Record<string, FieldMeta>>
export type EnumMap = Record<string, readonly string[]>
export type ZodChains = Record<string, Record<string, (base: any) => z.ZodTypeAny>>

export type MissingScopeContextMode = 'error' | 'warn' | 'ignore'

export interface GuardGeneratedConfig {
  onMissingScopeContext: MissingScopeContextMode
}

export interface GuardConfig {
  scopeMap: ScopeMap
  typeMap: TypeMap
  enumMap: EnumMap
  zodChains: ZodChains
  guardConfig: GuardGeneratedConfig
}

export interface QuerySchema<TCtx = unknown> {
  parse(body: unknown, opts?: { ctx?: TCtx }): Record<string, unknown>
  schemas: Record<string, z.ZodObject<any>>
}

export interface InputSchema {
  parse(data: unknown): Record<string, unknown>
  schema: z.ZodObject<any>
}
```

---

### Shared: `errors.ts`

```ts
export class PolicyError extends Error {
  readonly status = 403
  readonly code = 'POLICY_DENIED'
  constructor(message = 'Access denied', options?: ErrorOptions) {
    super(message, options)
    this.name = 'PolicyError'
  }
}

export class ShapeError extends Error {
  readonly status = 400
  readonly code = 'SHAPE_INVALID'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ShapeError'
  }
}

export class CallerError extends Error {
  readonly status = 400
  readonly code = 'CALLER_UNKNOWN'
  constructor(caller: string, options?: ErrorOptions) {
    super(`Unknown caller: ${caller}`, options)
    this.name = 'CallerError'
  }
}
```

---

### Generator: `validate-directive.ts`

Input: raw string after `@zod` (e.g. `.email().max(255)`)

Max length: 1024 characters. Reject with reason `"Directive exceeds maximum length"` if exceeded.

Max chain depth: 20 calls. Reject with reason `"Directive exceeds maximum chain depth"` if exceeded.

A minimal tokenizer. Whitespace (spaces, tabs) between tokens is ignored. Whitespace inside string literals is preserved. Accepts this grammar only:

```
chain    = call+
call     = "." ident "(" arglist? ")"
arglist  = arg ("," arg)*
arg      = string | number | boolean | null | array
array    = "[" (arg ("," arg)*)? "]"
string   = single-quoted or double-quoted, only \' and \" escapes allowed, all other backslash sequences rejected (including \\, \n, \t, \uXXXX)
number   = optional leading "-", digits, optional decimal, optional exponent. No "+", no "NaN", no "Infinity".
boolean  = "true" | "false"
null     = "null"
ident    = [a-zA-Z_][a-zA-Z0-9_]*
```

Rejects:
- Object literals (`{`, `}`)
- Template literals (backtick)
- Identifiers in arg position (only literals allowed)
- Nested function calls in args
- Non-`\'`/`\"` backslash sequences in strings (including `\\`, Unicode escapes)
- `NaN`, `Infinity`, `+` prefix on numbers
- Non-ASCII control characters (code point < 32) outside string literals
- Any tokens outside the grammar

After parsing, each `ident` is checked against an allowlist. Directives are pure constraints only — wrapping methods (`nullable`/`nullish`/`optional`/`default`) excluded to avoid collision with builder wrapping:

```ts
const ALLOWED_ZOD_METHODS = new Set([
  'min', 'max', 'length', 'email', 'url', 'uuid', 'cuid', 'cuid2',
  'ulid', 'trim', 'toLowerCase', 'toUpperCase',
  'startsWith', 'endsWith', 'includes',
  'datetime', 'ip', 'cidr', 'date', 'time', 'duration',
  'base64', 'nanoid', 'emoji',
  'int', 'positive', 'nonnegative', 'negative', 'nonpositive',
  'finite', 'safe', 'multipleOf', 'step',
  'gt', 'gte', 'lt', 'lte',
  'nonempty',
])
```

Unknown method → reject with reason `"Unknown zod method: ${ident}"`.

Returns `{ valid: true } | { valid: false; reason: string }`

---

### Generator: `emit-scope-map.ts`

Input: DMMF, `onAmbiguousScope` option

1. Collect scope roots: models where `documentation` contains `@scope-root` as a distinct token. Detection is token-based: split documentation by whitespace and newlines, check if any token is exactly `@scope-root`. Avoids false positives from substrings.
2. For every non-root model, iterate fields. If field has `relationFromFields` and the related model is a scope root, record `{ fk, root }`. Keys use exact DMMF model name (PascalCase).
3. After building the map, check for ambiguous multi-FK: if any model has multiple entries with the same `root`, handle based on `onAmbiguousScope`:
   - `"error"` (default) → exclude model from scope map entirely, log error with model name and conflicting FK names. Generation continues.
   - `"warn"` → exclude model, log warning
   - `"ignore"` → keep all entries (automatic scoping enforces all FKs simultaneously)
4. Collect all unique root model names from the scope map entries for `ScopeRoot` type emission.
5. Return TS source string for `SCOPE_MAP` const with `as const` and `ScopeRoot` type.

---

### Generator: `emit-zod-chains.ts`

Input: DMMF, `validateDirective` function, `onInvalidZod` option

1. Walk all models and fields
2. For each field where `documentation` contains `@zod`:
   - Extraction is line-scoped: find the line containing `@zod`, consume everything from `@zod` to end of that line, trim. If multiple lines contain `@zod` on the same field → throw (ambiguous).
   - Call `validateDirective`. If invalid:
     - `onInvalidZod === "error"` (default) → throw with model, field, reason
     - `onInvalidZod === "warn"` → log warning with model, field, reason. Skip.
   - Emit function: `fieldName: (base: any) => base{chainString},`
3. Return TS source string for `ZOD_CHAINS` (no `as const`)

---

### Generator: `emit-type-map.ts`

Input: DMMF

1. Walk all models and fields. For each field emit `FieldMeta` from DMMF properties:
   - `type` ← `field.type`
   - `isList` ← `field.isList`
   - `isRequired` ← `field.isRequired`
   - `isId` ← `field.isId`
   - `isRelation` ← `field.relationName !== undefined`
   - `hasDefault` ← `field.hasDefaultValue`
   - `isUpdatedAt` ← `field.isUpdatedAt`
   - `isEnum` ← check if `field.type` exists in `dmmf.datamodel.enums`
2. Collect all enums from `dmmf.datamodel.enums` into `ENUM_MAP`. If any enum has zero values, throw at generation time.
3. All keys use exact DMMF model names (PascalCase).
4. Emit `ModelName` and `FieldName<M>` type exports derived from `TYPE_MAP`.
5. Return TS source string for `TYPE_MAP` (with `as const`), `ENUM_MAP` (with `as const`), and type exports.

---

### Generator: `index.ts`

Shebang `#!/usr/bin/env node`. Uses `generatorHandler` from `@prisma/generator-helper`.

`onManifest`: returns `{ prettyName: 'Prisma Guard', defaultOutput: 'generated/guard' }`

`onGenerate`: reads generator options (`onInvalidZod`, `onAmbiguousScope`, `onMissingScopeContext`) from `options.generator.config`. Emits `GUARD_CONFIG` const with `onMissingScopeContext` value. Calls all three emitters with relevant options. Prepends `import { z } from 'zod'` only if `ZOD_CHAINS` is non-empty. Appends `ScopeRoot` type from scope map emitter. Writes single `index.ts` to output directory.

---

### Runtime: `zod-type-map.ts`

Two exported functions, no state. Each call returns a fresh zod instance.

`createBaseType(fieldMeta, enumMap)`:

If `fieldMeta.isEnum` and `enumMap[fieldMeta.type]` is undefined or empty → throw `ShapeError('Unknown enum: ${fieldMeta.type}')`.

```
String   → z.string()
Int      → z.number().int()
Float    → z.number()
Decimal  → z.number()
BigInt   → z.bigint()
Boolean  → z.boolean()
DateTime → z.coerce.date()
Json     → z.unknown()
Bytes    → z.string()
Enum     → z.enum(enumMap[fieldMeta.type])
```

If `fieldMeta.isList` → wrap in `z.array(...)`.

`createOperatorSchema(fieldMeta, operator, enumMap)`:

Accepts `FieldMeta` (not just field type string).

If `fieldMeta.isEnum`:
- Validate `enumMap[fieldMeta.type]` exists → throw `ShapeError` if not
- `equals`/`not` → `z.enum(enumMap[fieldMeta.type])`. If `!fieldMeta.isRequired` → `z.union([z.enum(...), z.null()])`
- `in`/`notIn` → `z.array(z.enum(enumMap[fieldMeta.type]))`
- Any other operator → throw `ShapeError('Operator "${operator}" not supported for enum fields')`

If scalar:
- Look up `fieldMeta.type` in scalar operator map → throw `ShapeError` if type not found
- For `equals`/`not` operators: if `!fieldMeta.isRequired` → return `z.union([scalarType, z.null()])`. Else → return `scalarType`.
- For `in`/`notIn` → `z.array(scalarType)` (no null in arrays)
- For all other operators → `scalarType`

Supported operators per type:

```
String:   equals, not, contains, startsWith, endsWith, in, notIn
Int:      equals, not, gt, gte, lt, lte, in, notIn
Float:    equals, not, gt, gte, lt, lte, in, notIn
Decimal:  equals, not, gt, gte, lt, lte, in, notIn
BigInt:   equals, not, gt, gte, lt, lte, in, notIn
Boolean:  equals, not
DateTime: equals, not, gt, gte, lt, lte, in, notIn
Enum:     equals, not, in, notIn
```

`mode` removed from operator map. Handled separately in `buildWhereSchema`.

---

### Runtime: `policy.ts`

One exported pure function.

`requireContext(ctx, label)` — if `ctx` is undefined, throw `PolicyError('Context required for ${label}')`.

Used by `query-builder` when shape is a function and ctx is not provided, and by `scope-extension` for missing context checks.

---

### Runtime: `scope-extension.ts`

`createScopeExtension(scopeMap, contextFn, guardConfig)` — returns `Prisma.defineExtension(...)`.

`contextFn` type: `() => Partial<Record<string, string | number | bigint>>`
`guardConfig` type: `GuardGeneratedConfig`

Operation sets (module-level consts, not exported):

```ts
const READ_OPS = new Set([
  'findMany', 'findFirst',
  'findFirstOrThrow',
  'count', 'aggregate', 'groupBy',
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
```

`findUnique`, `findUniqueOrThrow`, and `upsert` are not in the standard operation sets. All handled explicitly before set dispatch.

Per-operation logic in `$allOperations({ model, operation, args, query })`:

- Model undefined or not in scopeMap → `return query(args)` (original, untouched)
- Get scopes for model: `const scopes = scopeMap[model]`
- Build conditions: `scopes.filter(s => ctx[s.root] != null).map(s => ({ [s.fk]: ctx[s.root] }))`

**Missing scope context check (when model is in scope map but conditions are empty):**

Mutations always throw when context is missing, regardless of `onMissingScopeContext` setting. `warn`/`ignore` only applies to reads.

```ts
if (conditions.length === 0) {
  const isMutation = CREATE_OPS.has(operation) ||
    MUTATION_WITH_WHERE_OPS.has(operation) ||
    operation === 'upsert'

  if (isMutation || guardConfig.onMissingScopeContext === 'error') {
    throw new PolicyError(
      `Missing scope context for model "${model}". Ensure AsyncLocalStorage is configured.`
    )
  }
  if (guardConfig.onMissingScopeContext === 'warn') {
    console.warn(
      `prisma-guard: Missing scope context for model "${model}". Read proceeding unscoped.`
    )
  }
  return query(args)
}
```

- Build overrides: `Object.fromEntries(scopes.filter(s => ctx[s.root] != null).map(s => [s.fk, ctx[s.root]]))`

**Explicit upsert block (before any other dispatch):**

```ts
if (operation === 'upsert') {
  throw new ShapeError(
    `Scoped model "${model}" cannot use upsert via extension. Handle upsert explicitly in route logic.`
  )
}
```

**findUnique/findUniqueOrThrow — post-query verification with select merging:**

```ts
if (FIND_UNIQUE_OPS.has(operation)) {
  const nextArgs = { ...args }
  const injectedFks: string[] = []

  if (nextArgs.select) {
    nextArgs.select = { ...nextArgs.select }
    for (const condition of conditions) {
      const fk = Object.keys(condition)[0]
      if (!args.select[fk]) {
        nextArgs.select[fk] = true
        injectedFks.push(fk)
      }
    }
  }

  const result = await query(nextArgs)
  if (result === null) return result

  for (const condition of conditions) {
    const [fk, value] = Object.entries(condition)[0]
    if (result[fk] !== value) {
      if (operation === 'findUniqueOrThrow') {
        throw new ShapeError('Record not found in scope')
      }
      return null
    }
  }

  for (const fk of injectedFks) {
    delete result[fk]
  }

  return result
}
```

**Set-based dispatch:**

Clone args before any mutation:

```ts
const nextArgs = { ...args }
```

- **Read (READ_OPS):** `nextArgs.where = { AND: [args.where ? { ...args.where } : {}, ...conditions] }`
- **Create (CREATE_OPS):** if `createMany`/`createManyAndReturn` → if `!Array.isArray(args.data)` throw `ShapeError('${operation} expects data to be an array')`. Then `nextArgs.data = args.data.map(d => ({ ...d, ...overrides }))`. If `create` → `nextArgs.data = { ...args.data, ...overrides }`
- **Mutation with where (MUTATION_WITH_WHERE_OPS):** `nextArgs.where = { AND: [args.where ? { ...args.where } : {}, ...conditions] }`. If `args.data` exists → `nextArgs.data = { ...args.data }`, then delete FK keys from `nextArgs.data`
- **Unknown operation on scoped model:** throw `ShapeError('Unknown operation "${operation}" on scoped model "${model}". Update prisma-guard to handle this operation.')`

All paths that modify return `query(nextArgs)`. findUnique paths return verified (and possibly stripped) result directly. Unknown operations on scoped models throw. Unscoped models with unknown operations return `query(args)` untouched.

Consumer must use `AsyncLocalStorage` for request context. Documented with example.

---

### Runtime: `schema-builder.ts`

`createSchemaBuilder(typeMap, zodChains, enumMap)` — returns `{ buildFieldSchema, buildInputSchema, buildModelSchema }`.

Two internal caches with max size:

```ts
const MAX_CACHE_ENTRIES = 500
const baseCache = new Map<string, z.ZodTypeAny>()
const chainCache = new Map<string, z.ZodTypeAny>()
```

When either cache exceeds `MAX_CACHE_ENTRIES`, it is cleared entirely. Both keyed by `${model}.${field}`.

`buildFieldSchema(model, field)`:

1. Check `chainCache` → return if hit
2. Look up `typeMap[model][field]` → throw `ShapeError` if missing
3. `createBaseType(fieldMeta, enumMap)` → store in `baseCache`
4. If `zodChains[model]?.[field]` exists → wrap in try/catch. Call chain with base type. If throws → throw `ShapeError('Invalid @zod directive on ${model}.${field} (${fieldMeta.type}): ${caught.message}', { cause: caught })`. Store result in `chainCache`.
5. If no chain exists → store base in `chainCache` as well (base === chain)
6. Return from `chainCache`

`buildInputSchema(model, opts)`:

Resolves mode: `mode = opts.mode ?? 'create'`
Resolves allowNull: `allowNull = opts.allowNull ?? true`

1. Get all fields from `typeMap[model]`
2. Exclude: `isRelation === true`, `isUpdatedAt === true`
3. Apply `pick` or `omit`. Validate every field name in `pick`/`omit` against `typeMap[model]` → if field doesn't exist, throw `ShapeError('Unknown field "${field}" on model "${model}"')`. If `pick` contains a relation or `isUpdatedAt` field → throw `ShapeError('Field "${field}" cannot be used in input schema')`.
4. For each remaining field:
   - If `refine[field]` exists → get from `baseCache` if available, else `createBaseType(fieldMeta, enumMap)`. Pass to `refine[field]()`. Consumer owns the full definition. No `@zod` chain applied.
   - Else → `buildFieldSchema(model, field)` (from `chainCache`, with chain)
   - Wrapping per mode:
     - **`create`:** if `!isRequired` → `.nullable().optional()`. Else if `hasDefault` → `.optional()`. Else → required (no wrapping).
     - **`update`:** if `!isRequired` and `allowNull` → `.nullable().optional()`. If `!isRequired` and `!allowNull` → `.optional()`. If `isRequired` → `.optional()`.
5. `z.object(schemaMap).strict()`
6. If `partial` → `.partial()`
7. Store the zod object as `schema` on the returned `InputSchema`
8. Return `InputSchema` with `parse(data)` and `schema`

`InputSchema.parse(data)`:

1. Zod validation
2. Return validated data

Context-free. Pure validation. RBAC is handled externally.

`buildModelSchema(model, opts, depth = 0)`:

1. If `depth > 5` → throw `ShapeError('Maximum include depth exceeded')`
2. Get all fields from `typeMap[model]`
3. Exclude `isRelation === true` unless field is a key in `opts.include`
4. Apply `pick` or `omit` (only to scalar fields). Validate field names against `typeMap[model]` → throw `ShapeError` for unknown fields.
5. For scalars: build zod types via `buildFieldSchema`, apply nullable wrapping if `!isRequired`
6. For included relations: look up related model from `typeMap[model][field].type`, verify it exists in `typeMap`. Recursively `buildModelSchema(relatedModel, opts.include[field], depth + 1)`. If `isList` → wrap result in `z.array(...)`
7. Build `z.object(schemaMap)`. If `opts.strict === true` → apply `.strict()`.
8. Return

---

### Runtime: `query-builder.ts`

`createQueryBuilder(typeMap, enumMap)` — returns `{ buildQuerySchema }`.

Module-level consts (not exported):

```ts
const METHOD_ALLOWED_ARGS: Record<QueryMethod, Set<string>> = {
  findMany:            new Set(['where', 'include', 'select', 'orderBy', 'take', 'skip']),
  findFirst:           new Set(['where', 'include', 'select', 'orderBy', 'take', 'skip']),
  findFirstOrThrow:    new Set(['where', 'include', 'select', 'orderBy', 'take', 'skip']),
  findUnique:          new Set(['where', 'include', 'select']),
  findUniqueOrThrow:   new Set(['where', 'include', 'select']),
  count:               new Set(['where']),
}

const SHAPE_CONFIG_KEYS = new Set(['where', 'include', 'select', 'orderBy', 'take', 'skip'])

const MAX_CACHE_ENTRIES = 500
```

Internal schema cache: `Map<string, z.ZodTypeAny>`. Cleared when exceeding `MAX_CACHE_ENTRIES`. Key built from resolved shape config (after function call) via `${model}:${method}:${JSON.stringify(resolvedShape)}`.

`buildQuerySchema(model, method, config)`:

1. Detect mode: if `config` is a function or any top-level key of `config` is in `SHAPE_CONFIG_KEYS` → single shape mode. Else → caller map mode (each value is a `ShapeOrFn`).
2. For each shape: if the shape is a function → mark as ctx-required for that shape.
3. Validate resolved shapes against method at build time for static shapes. For function shapes, validation happens at parse time after resolution.
4. Store schemas on `schemas`. In single shape mode, stored under key `_default`. In caller map mode, stored under each caller key. For function shapes, `schemas` entry is `null` until first parse.
5. Return `QuerySchema` with `parse(body, opts?)` and `schemas`

`QuerySchema.parse(body, opts?)`:

**Caller map mode:**
1. Extract `caller` from body
2. If missing → throw `CallerError('missing')`
3. Match against shapes: exact match first, then pattern match (split by `/`, `:param` segments match any value, extracted params discarded). When multiple patterns could match, first declared wins (object key insertion order).
4. No match → throw `CallerError(caller)`
5. Remove `caller` from body
6. Use matched `ShapeOrFn`

**Single shape mode:**
1. Use config directly. No `caller` required.

**Both modes then:**
7. Resolve shape: if function → require ctx (`requireContext(opts?.ctx, 'shape function')`), call `shape(ctx)` to get `ShapeConfig`. If object → use directly.
8. Validate resolved shape against method: check that declared arg types (`where`, `include`, `select`, `orderBy`, `take`, `skip`) are in `METHOD_ALLOWED_ARGS[method]`. If client sent both `include` and `select` → throw `ShapeError('Cannot use both select and include in the same query')`.
9. Walk resolved shape. Separate `true` entries (client schema) from literal entries (forced values) in `where`.
10. Build zod schema from `true`-only entries. Validate client body against this schema. Unknown top-level keys rejected (`.strict()`).
11. Merge forced where values via `AND` composition: if both clientWhere and forcedWhere exist → `{ AND: [clientWhere, forcedWhere] }`. If only one exists, use it. If neither, omit.
12. For `include`/`select`/`orderBy`: `true` entries become the zod schema (client controls which allowed fields to include/select/order by). No forced values — these are structural and always just allowed or not.
13. Return clean Prisma args.

`buildWhereSchema(model, whereConfig)`:

1. Separate entries: for each field in `whereConfig`, for each operator: if value is `true` → client-controlled. If value is not `true` → forced (stored separately, not in zod schema).
2. For each client-controlled field/operator: look up field in `typeMap[model]` → if missing, throw `ShapeError`. If `isRelation`, throw `ShapeError`. If type is `Json`, throw `ShapeError`.
3. For each operator: `createOperatorSchema(fieldMeta, operator, enumMap).optional()`
4. If field type is `String` and any of `contains`, `startsWith`, `endsWith`, `equals` is client-controlled → automatically add `mode: z.enum(['default', 'insensitive']).optional()`.
5. Per-field: `z.object({ op1: ..., op2: ... }).strict().optional()`
6. Full where: `z.object({ field1: ..., field2: ... }).strict().optional()`
7. Return `{ schema, forced }` where `forced` is the object of literal values to merge via AND.

`buildIncludeSchema(model, includeConfig)`:

1. For each key in `includeConfig`:
2. Look up in `typeMap[model]` — must be `isRelation: true`, else throw `ShapeError`
3. Determine related model from `typeMap[model][key].type`
4. If value is `true` → `z.literal(true).optional()`
5. If value is `NestedIncludeArgs` → `z.union([z.literal(true), z.object({ ... }).strict()]).optional()` where the object may contain:
   - `where`: recursively build where schema for the related model
   - `include`: recursively build include schema for the related model
   - `orderBy`: build orderBy schema for the related model
   - `take`: build take schema
   - `skip`: `z.number().int().min(0).optional()` if configured
6. Wrap all: `z.object({ rel1: ..., rel2: ... }).strict().optional()`

`buildSelectSchema(model, selectConfig)`:

1. For each key in `selectConfig`:
2. Look up in `typeMap[model]`
3. If field is scalar and value is `true` → `z.literal(true).optional()`
4. If field is relation and value is `true` → `z.literal(true).optional()`
5. If field is relation and value is `NestedSelectArgs` → `z.union([z.literal(true), z.object({ ... }).strict()]).optional()` where the object may contain:
   - `select`: recursively build select schema for the related model
   - `where`: recursively build where schema for the related model
   - `orderBy`: build orderBy schema for the related model
   - `take`: build take schema
   - `skip`: if configured
6. Wrap all: `z.object({ field1: ..., rel1: ... }).strict().optional()`

`buildOrderBySchema(model, orderByConfig)`:

For each field where value is `true`: look up in `typeMap[model]`. If missing → throw `ShapeError`. If `isRelation` → throw `ShapeError`. If type is `Json` → throw `ShapeError`.

Single object: `z.object({})` with each allowed field as `z.enum(['asc', 'desc']).optional()`. `.strict()`.

Accept both: `z.union([singleSchema, z.array(singleSchema)]).optional()`

`buildTakeSchema(config)`:

If `config.default > config.max` → throw `ShapeError('take default cannot exceed max')`.

`z.number().int().min(1).max(config.max).default(config.default)`

---

### Runtime: `guard.ts`

```ts
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
    ) => queryBuilder.buildQuerySchema(model, method, config),

    extension: (contextFn: () => Partial<Record<TRoots, string | number | bigint>>) =>
      createScopeExtension(config.scopeMap, contextFn, config.guardConfig),
  }
}
```

Consumer usage:

```ts
import {
  SCOPE_MAP, TYPE_MAP, ENUM_MAP, ZOD_CHAINS, GUARD_CONFIG,
} from './generated/guard'
import type { ScopeRoot } from './generated/guard'

type AppContext = { companyId: string; userId: string; companyRole: string }

const guard = createGuard<typeof TYPE_MAP, ScopeRoot>({
  scopeMap: SCOPE_MAP,
  typeMap: TYPE_MAP,
  enumMap: ENUM_MAP,
  zodChains: ZOD_CHAINS,
  guardConfig: GUARD_CONFIG,
})

// Input — no context, pure validation
const createUser = guard.input('User', {
  mode: 'create',
  pick: ['email', 'displayName'],
})

// Static query — no context needed
const findManySkills = guard.query('SkillsList', 'findMany', {
  where: {
    label: { contains: true },
  },
  orderBy: { label: true },
  take: { max: 100, default: 50 },
})

// Context-dependent query — forced values from ctx
const findManyAssignments = guard.query<AppContext>('JobAssignment', 'findMany', {
  '/sales/assignments': (ctx) => ({
    where: {
      salesCompanyId: { equals: ctx.companyId },
      startDate: { gte: true, lte: true },
      endDate: { gte: true, lte: true },
    },
    include: {
      jobDescription: true,
      talentProfile: true,
    },
    take: { max: 50, default: 20 },
  }),
  '/client/assignments': (ctx) => ({
    where: {
      clientCompanyId: { equals: ctx.companyId },
      startDate: { gte: true, lte: true },
      endDate: { gte: true, lte: true },
    },
    include: {
      jobDescription: true,
      salesCompany: true,
    },
    take: { max: 50, default: 20 },
  }),
})

// Select example
const findManyUsersSelect = guard.query('User', 'findMany', {
  '/admin/users': {
    where: {
      email: { contains: true },
      displayName: { contains: true },
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      companies: {
        select: { companyId: true, roleId: true },
      },
    },
    take: { max: 100, default: 25 },
  },
})

// Scope extension — typed roots
const prisma = new PrismaClient().$extends(
  guard.extension(() => ({
    Company: ctx.companyId,
    User: ctx.userId,
  }))
)

// Handlers
app.post('/api/user', async (req, res) => {
  const data = createUser.parse(req.body)
  const user = await prisma.user.create({ data })
  res.json(user)
})

app.post('/api/jobAssignment/findMany', async (req, res) => {
  const args = findManyAssignments.parse(req.body, { ctx: req.ctx })
  const results = await prisma.jobAssignment.findMany(args)
  res.json(results)
})

app.post('/api/skillsList/findMany', async (req, res) => {
  const args = findManySkills.parse(req.body)
  const results = await prisma.skillsList.findMany(args)
  res.json(results)
})
```

---

### Runtime: `index.ts`

Exports: `createGuard`, `PolicyError`, `ShapeError`, `CallerError`, all type interfaces.

---

### Dependency graph

```
guard.ts
  ├── schema-builder.ts
  │     └── zod-type-map.ts
  ├── query-builder.ts
  │     ├── zod-type-map.ts
  │     └── policy.ts (requireContext only)
  ├── scope-extension.ts
  └── shared/
        ├── types.ts
        └── errors.ts
```

No circular deps. `schema-builder` and `query-builder` are independent of each other. `policy.ts` contains only `requireContext`.

---

### Implementation order

**Phase 1 — generator (parallel):**
- `validate-directive.ts`
- `emit-scope-map.ts`
- `emit-zod-chains.ts` (depends on validate-directive)
- `emit-type-map.ts`
- `index.ts`

**Phase 2 — runtime core (parallel):**
- `shared/errors.ts`
- `shared/types.ts`
- `zod-type-map.ts`
- `policy.ts`
- `scope-extension.ts`

**Phase 3 — runtime builders (parallel):**
- `schema-builder.ts`
- `query-builder.ts`

**Phase 4 — composition:**
- `guard.ts`
- `runtime/index.ts`

---

### Two-layer tenant isolation pattern

**Layer 1: Scope extension (automatic, simple models)**

Models with a single unambiguous FK to a scope root are in `SCOPE_MAP`. The extension handles them automatically — reads get `AND` conditions, creates get FK overrides, updates get FK stripped, findUnique gets post-query verification.

**Layer 2: Shape functions with forced literals (explicit, complex models)**

Models excluded from `SCOPE_MAP` are handled via shape functions that inject forced literal values from context:

```ts
const findManyAssignments = guard.query<AppContext>('JobAssignment', 'findMany', {
  '/sales/assignments': (ctx) => ({
    where: {
      salesCompanyId: { equals: ctx.companyId },   // forced — server controls
      startDate: { gte: true, lte: true },         // true — client controls
      endDate: { gte: true, lte: true },
    },
    include: {
      jobDescription: true,
      talentProfile: true,
    },
    take: { max: 50, default: 20 },
  }),
  '/client/assignments': (ctx) => ({
    where: {
      clientCompanyId: { equals: ctx.companyId },
      startDate: { gte: true, lte: true },
      endDate: { gte: true, lte: true },
    },
    include: {
      jobDescription: true,
      salesCompany: true,
    },
    take: { max: 50, default: 20 },
  }),
})
```

The caller path determines which shape is used. Which user can access which path is determined by prisma-rbac or route-level middleware.

**Models with indirect FK (e.g. `talentJobApplication` → `jobAd` → `company`):**

Handle via route-level lookups before `parse`:

```ts
app.post('/api/talentJobApplication/findMany', async (req, res) => {
  const jobAdIds = await prisma.jobAd.findMany({
    where: { publisherCompanyId: req.ctx.companyId },
    select: { id: true },
  })
  const args = findManyApplications.parse(req.body, { ctx: req.ctx })
  args.where = {
    AND: [args.where ?? {}, { jobAdId: { in: jobAdIds.map(j => j.id) } }],
  }
  const results = await prisma.talentJobApplication.findMany(args)
  res.json(results)
})
```

---

### Features

**Generator**

1. Scope map emission — static analysis of `/// @scope-root` models and FK tracing to produce `SCOPE_MAP` const. Keys use exact PascalCase DMMF model names.
2. Type map emission — per-model field metadata extraction from DMMF to produce `TYPE_MAP` const. Keys use exact PascalCase DMMF model names.
3. Enum map emission — extraction of all enum definitions from DMMF to produce `ENUM_MAP` const. Empty enums rejected at generation time.
4. Zod chain emission — parsing `/// @zod` directives from field documentation into runtime functions to produce `ZOD_CHAINS`. Extraction is line-scoped: consume from `@zod` to end of line only. Multiple `@zod` lines on the same field throws.
5. Directive validation — tokenizer-based grammar check on `@zod` directive strings before emitting as executable code. Accepts `.method(primitiveArgs)` chains only. Whitespace between tokens tolerated. Rejects object literals, template literals, identifiers in arg position, nested function calls, non-`\'`/`\"` backslash sequences (including `\\` and Unicode escapes), `NaN`/`Infinity`/`+` prefix numbers, non-ASCII control characters. Max directive length 1024 chars. Max 20 chain calls. Method names checked against allowlist — `nullable`/`nullish`/`optional`/`default` excluded.
6. Configurable invalid directive handling — default: throw on invalid `@zod` directive. Configurable via `onInvalidZod` to warn and skip.
7. Single file output — all generated artifacts in one `index.ts`.
8. Conditional zod import — `import { z }` only emitted when `ZOD_CHAINS` is non-empty.
9. Robust scope-root detection — token-based scan avoiding false positives from substrings.
10. Ambiguous multi-FK handling — detects multiple FKs to same root. `"error"` (default) excludes model from scope map and logs. Excluded models handled via shape functions with forced literals.
11. Typed model and scope root exports — `ModelName`, `FieldName<M>`, `ScopeRoot` for compile-time validation.
12. Guard config emission — `GUARD_CONFIG` const for runtime scope extension configuration.

**Input validation (`guard.input`)**

13. Prisma-to-zod type mapping — automatic conversion of all Prisma scalar types. `DateTime` uses `z.coerce.date()`. `Json` uses `z.unknown()`. `Bytes` uses `z.string()`. `Decimal` uses `z.number()`. Override with `refine`.
14. List field handling — list types wrapped in `z.array()`.
15. Enum field handling — `z.enum()` with values from `ENUM_MAP`. Runtime `ShapeError` if enum missing.
16. `@zod` chain application — auto-applied from schema comments. Try/catch with descriptive `ShapeError` including model, field, field type. `cause` set.
17. `pick` / `omit` filtering — validated against `typeMap`. Unknown fields, relations, `@updatedAt` fields throw `ShapeError`.
18. `partial` mode — `.partial()` on entire schema.
19. `refine` overrides — fresh base type from `baseCache`, no `@zod` chain.
20. Auto-exclusion of relation fields.
21. Auto-exclusion of `@updatedAt` fields.
22. Create/update mode — create requires non-nullable non-default fields. Update makes all optional. Configurable via `allowNull`.
23. Null control on update — `allowNull: false` makes nullable fields `.optional()` only.
24. Strict mode — `.strict()` on all input schemas.
25. Schema exposure — `.schema` for `z.infer`.
26. Dual cache — `baseCache` + `chainCache`, 500 entry cap.
27. Typed model parameter — constrained to `ModelName`.
28. Context-free parsing — `parse(data)` is pure validation.

**Output shaping (`guard.model`)**

29. Output schema construction — `pick`/`omit` validated against `typeMap`.
30. Nested include in output — recursive `include` for relation schemas.
31. List relation wrapping — `isList` → `z.array()`.
32. Max depth guard — hard limit 5.
33. Optional strict mode — `strict?: boolean` on `ModelOpts`.

**Query shape enforcement (`guard.query`)**

34. Prisma-native shape config — query shapes mirror Prisma args syntax. `true` means client controls the value. Literal values mean server forces the value. No custom DSL — the shape IS the boundary.
35. Shape functions — shapes can be functions of context: `(ctx) => ShapeConfig`. Function shapes require ctx at parse time. Static shapes don't.
36. Forced literal values in where — non-`true` values in where config are hidden from the client, merged via `AND` into validated client where. Primary mechanism for tenant scoping on complex models.
37. Where field/operator derivation from DMMF — field types and nullable handling auto-derived from `TYPE_MAP`. No manual type specification needed.
38. Nullable-aware operators — `equals`/`not` accept `z.null()` union when field is nullable. `in`/`notIn` stay non-null.
39. Automatic `mode` for string filters — auto-added when `contains`/`startsWith`/`endsWith`/`equals` are client-controlled.
40. Json field rejection in where — throws `ShapeError` at build time.
41. Relation and Json rejection in orderBy — throws `ShapeError`.
42. Enum-aware operator schemas — correct enum/scalar operators from `FieldMeta`.
43. Include whitelisting — Prisma-shaped. `true` = allowed flat. Object = allowed with nested constraints.
44. Select whitelisting — Prisma-shaped. `true` on scalars = selectable. Object on relations = selectable with nested constraints.
45. Select/include mutual exclusivity — client sending both throws `ShapeError`.
46. Include/select depth — controlled by config nesting depth. No explicit `maxDepth` number needed.
47. Nested include/select args — where, orderBy, take, skip configurable per nested relation.
48. OrderBy whitelisting — `true` entries only.
49. OrderBy array support — single object or array.
50. Take clamping — `max` and `default` (required). `default > max` throws `ShapeError`.
51. Skip validation — non-negative integer.
52. Method-aware arg validation — rejects invalid args per method. `findFirst`/`findFirstOrThrow` allow `take`. `count` only allows `where`.
53. Strict top-level rejection — unknown keys rejected.
54. Schema caching — cached by resolved shape, 500 entry cap.
55. Schema exposure — `.schemas` for `z.infer`. Single shape uses `_default` key.

**Caller routing**

56. Multi-shape per endpoint — discriminated by `caller` in request body.
57. Single shape mode — no `caller` required when config is a single `ShapeOrFn`.
58. Exact match routing — tried first.
59. Pattern match routing — `:param` segments match any value, params discarded.
60. Deterministic pattern conflict resolution — first declared wins.
61. Unknown caller rejection — `CallerError` with 400.

**Row-level tenant isolation (`guard.extension`)**

62. Scope root detection — `/// @scope-root` models.
63. Automatic FK discovery — direct unambiguous FKs to scope roots.
64. Missing scope context handling — default `"error"` throws `PolicyError`. `"warn"`/`"ignore"` only for reads. Mutations always throw when context missing.
65. Read scoping — `AND` into where. `args.where` cloned via spread.
66. findUnique/findUniqueOrThrow post-query verification — `select` force-includes FK fields, strips after verification.
67. Upsert blocking — throws `ShapeError` on scoped models.
68. Create scoping — FK override. `createMany` throws if data not array.
69. Update/delete scoping — `AND` into where, strip FK from data copy.
70. Arg cloning — shallow clone modified objects. `args.where` cloned in `AND` composition.
71. Partial context — only non-null roots enforced.
72. Unscoped model passthrough — includes ambiguous multi-FK models.
73. Unknown operation denial on scoped models — throws `ShapeError`. Unscoped models unaffected.
74. Defensive operation handling — version-dependent ops handled defensively.
75. AsyncLocalStorage pattern — documented.
76. Typed scope context — `ScopeRoot` constrains `contextFn` keys.

**Error handling**

77. Typed error classes — `PolicyError` (403, `POLICY_DENIED`), `ShapeError` (400, `SHAPE_INVALID`), `CallerError` (400, `CALLER_UNKNOWN`). All with `status`, `code`, `name`, `cause`.
78. Separation from ZodError — shape and caller errors distinct from validation errors.

---

### Known limitations (v1)

- RBAC is out of scope. Use [prisma-rbac](https://github.com/multipliedtwice/prisma-rbac) or equivalent.
- Where clauses: top-level scalar fields only, no relation-level filtering.
- No `AND`/`OR`/`NOT` in client where args. Forced literal values and scope extension output may include `AND` in final Prisma args.
- Prisma where shorthand (`where: { id: 1 }`) not supported; use explicit operator form (`where: { id: { equals: 1 } }`).
- Json fields cannot be used in where or orderBy.
- `aggregate` and `groupBy` not supported in `guard.query()`. Scope extension does enforce tenant isolation on these via where injection.
- `@zod` directives: primitive args only. Max 1024 chars, max 20 chains. `nullable`/`nullish`/`optional`/`default` not allowed. Use `refine` for complex validators.
- `@zod` method/type compatibility not checked at generation time. Incompatible chains throw `ShapeError` at schema build time with descriptive message. Some allowlisted methods may not exist in older zod versions.
- `refine` bypasses `@zod` chains — receives fresh base type.
- `Bytes` → `z.string()`. Pair with `/// @zod .base64()`.
- `Decimal` → `z.number()`. Override with `refine` for string Decimals.
- `DateTime` → `z.coerce.date()`. Override with `refine` for strict parsing.
- `Json` → `z.unknown()`.
- `upsert` blocked on scoped models. Handle explicitly in route logic.
- findUnique post-query verification fetches before checking scope. When `select` used, FK fields force-included and stripped from result.
- Raw queries bypass scope extension.
- Nested writes not scoped by extension.
- Ambiguous multi-FK models excluded from scope map. Handle via shape functions with forced literals.
- Indirect FK models not in scope map. Handle via route-level lookups.
- `select` and `include` mutually exclusive per Prisma semantics. Client sending both throws `ShapeError`.
- `count` does not support `select` in prisma-guard.
- Arg cloning is shallow. `args.where` cloned in AND composition. Deeply nested objects within where share references. Do not reuse/mutate args after passing to Prisma.
- Unknown Prisma operations throw `ShapeError` on scoped models. Unscoped models unaffected.
- Create mode requiredness is an approximation from DMMF metadata.
- Schema cache keys use `JSON.stringify`. Key-order misses are harmless. Caches capped at 500.
- Caller pattern params discarded. Not passed to shape functions.
- Pattern conflict resolution: first declared wins.
- Generated output is TypeScript. Consumer's tsconfig must include output directory.
- Enum `not` only accepts enum values, not nested Prisma filter objects.
- `ScopeRoot` is `never` if no scope roots. `contextFn` accepts any keys in that case.
- `onMissingScopeContext` `"warn"`/`"ignore"` only affects reads. Mutations always throw.
- Shape functions are called on every parse, not cached. Keep them lightweight.