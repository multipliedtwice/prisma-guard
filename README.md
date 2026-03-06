
# prisma-guard

**Schema-driven security layer for Prisma**
Generate input validation, query shape enforcement, and tenant isolation directly from your Prisma schema.

[![npm version](https://img.shields.io/npm/v/prisma-guard)](https://www.npmjs.com/package/prisma-guard)
[![license](https://img.shields.io/npm/l/prisma-guard)](./LICENSE)
[![node](https://img.shields.io/node/v/prisma-guard)](./package.json)
[![prisma](https://img.shields.io/badge/Prisma-6%20%7C%207-2D3748)](https://www.prisma.io/)
[![zod](https://img.shields.io/badge/Zod-v4-3E67B1)](https://zod.dev/)

`prisma-guard` helps prevent three common classes of backend mistakes:

* **invalid input** reaching Prisma
* **unsafe or overly broad query shapes**
* **missing tenant filters** in multi-tenant systems

```text
client request
      ↓
validated input
      ↓
allowed query shape
      ↓
tenant scoped query
      ↓
database
```

---

## Table of contents

* [Why this exists](#why-this-exists)
* [What prisma-guard does](#what-prisma-guard-does)
* [Architecture](#architecture)
* [Install](#install)
* [Quick start](#quick-start)
* [Before / After prisma-guard](#before--after-prisma-guard)
* [Schema annotations](#schema-annotations)
* [Input validation](#input-validation)
* [Query shape enforcement](#query-shape-enforcement)
* [Automatic tenant isolation](#automatic-tenant-isolation)
* [findUnique behavior](#findunique-behavior)
* [Security model](#security-model)
* [Limitations](#limitations)
* [Advanced: SQL-backed runtimes](#advanced-sql-backed-runtimes)
* [Output shaping](#output-shaping)
* [Error handling](#error-handling)
* [How it works internally](#how-it-works-internally)
* [Why this approach](#why-this-approach)
* [Performance characteristics](#performance-characteristics)
* [Security philosophy](#security-philosophy)
* [Recommended production configuration](#recommended-production-configuration)
* [When to use prisma-guard](#when-to-use-prisma-guard)
* [Version compatibility](#version-compatibility)
* [Design principles](#design-principles)
* [Comparison](#comparison)
* [Roadmap](#roadmap)
* [License](#license)

---

## Why this exists

Prisma is powerful, but most real backends eventually hit the same problems.

### Missing input validation

```ts
await prisma.user.create({
  data: req.body,
})
```

The client controls the entire payload.

### Dangerous query shapes

```ts
await prisma.project.findMany({
  include: {
    tasks: {
      include: {
        comments: true,
      },
    },
  },
})
```

A client can accidentally or intentionally trigger expensive query trees.

### Tenant isolation bugs

```ts
await prisma.project.findUnique({
  where: { id: projectId },
})
```

If `projectId` belongs to another tenant, data can leak.

---

## What prisma-guard does

`prisma-guard` turns your Prisma schema into a runtime **data boundary layer**.

| Feature                 | Description                                 |
| ----------------------- | ------------------------------------------- |
| Input validation        | Zod schemas generated from Prisma types     |
| Query shape enforcement | Only allowed query shapes pass validation   |
| Tenant isolation        | Prisma extension injects tenant filters     |
| Schema-driven           | Rules come directly from your Prisma schema |

The goal is simple:

> Clients should not be able to accidentally or maliciously escape the data boundary defined by your schema.

`prisma-guard` is focused on **data boundaries**, not RBAC.
Role-based access control is intentionally out of scope.

---

## Architecture

`prisma-guard` sits between your application and Prisma Client.

```text
┌───────────────┐
│   Client      │
│  (API / RPC)  │
└───────┬───────┘
        │ request
        ▼
┌──────────────────────┐
│  Input Validation     │
│  (Generated Zod)      │
└─────────┬────────────┘
          │ validated input
          ▼
┌──────────────────────┐
│ Query Shape Guard     │
│ (Allowed filters /    │
│  relations / ordering)│
└─────────┬────────────┘
          │ validated query
          ▼
┌──────────────────────┐
│ Tenant Scope Layer    │
│ (Prisma extension)    │
│ injects tenant filter │
└─────────┬────────────┘
          │ scoped query
          ▼
┌──────────────────────┐
│    Prisma Client      │
└─────────┬────────────┘
          │ SQL
          ▼
┌──────────────────────┐
│       Database        │
└──────────────────────┘
```

The boundary is generated from your Prisma schema.

---

## Install

```bash
npm install prisma-guard zod @prisma/client
```

Peer dependencies:

* `zod ^4`
* `@prisma/client ^6 || ^7`

---

## Quick start

### 1. Add the generator

```prisma
generator guard {
  provider = "prisma-guard"
  output   = "generated/guard"
}
```

### 2. Generate

```bash
npx prisma generate
```

### 3. Import generated config

```ts
import {
  SCOPE_MAP,
  TYPE_MAP,
  ENUM_MAP,
  ZOD_CHAINS,
  GUARD_CONFIG,
} from './generated/guard'
import type { ScopeRoot } from './generated/guard'
import { createGuard } from 'prisma-guard'
```

### 4. Create the guard

```ts
const guard = createGuard<typeof TYPE_MAP, ScopeRoot>({
  scopeMap: SCOPE_MAP,
  typeMap: TYPE_MAP,
  enumMap: ENUM_MAP,
  zodChains: ZOD_CHAINS,
  guardConfig: GUARD_CONFIG,
})
```

### 5. Create a scoped Prisma client

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient } from '@prisma/client'

const store = new AsyncLocalStorage<{ tenantId: string }>()

const prisma = new PrismaClient().$extends(
  guard.extension(() => {
    const ctx = store.getStore()
    return {
      Tenant: ctx?.tenantId,
    }
  }),
)
```

### 6. Validate input

```ts
const createProject = guard.input('Project', {
  mode: 'create',
  pick: ['title'],
})

const data = createProject.parse(req.body)

await prisma.project.create({
  data,
})
```

### 7. Enforce query shapes

```ts
const listProjects = guard.query('Project', 'findMany', {
  where: {
    title: { contains: true },
  },
  orderBy: { title: true },
  take: { max: 50, default: 20 },
})

const args = listProjects.parse(req.body)

await prisma.project.findMany(args)
```

---

## Before / After prisma-guard

### Without prisma-guard

```ts
await prisma.project.create({
  data: req.body,
})

await prisma.project.findMany(req.query)

await prisma.project.findUnique({
  where: { id: projectId },
})
```

Problems:

* unvalidated input
* unrestricted query shape
* missing tenant filter

### With prisma-guard

```ts
const input = guard.input('Project', {
  mode: 'create',
  pick: ['title'],
}).parse(req.body)

const args = guard.query('Project', 'findMany', {
  where: { title: { contains: true } },
  take: { max: 50, default: 20 },
}).parse(req.body)

await prisma.project.create({ data: input })

await prisma.project.findMany(args)

await prisma.project.findFirst({
  where: { id: projectId },
})
```

What changed:

| Risk                | Mitigation                |
| ------------------- | ------------------------- |
| arbitrary input     | Zod validation            |
| expensive queries   | shape whitelist           |
| cross-tenant access | automatic scope injection |

---

## Schema annotations

### Mark tenant root models

Use `@scope-root` on models that represent tenant roots.

```prisma
/// @scope-root
model Tenant {
  id   String @id @default(cuid())
  name String
}
```

Models with a single unambiguous foreign key to a scope root are auto-scoped.

If a model has multiple foreign keys to the same scope root, it is excluded from the auto-scope map unless you intentionally relax that behavior.

### Add field-level validation with `@zod`

```prisma
model User {
  id    String @id @default(cuid())
  /// @zod .email().max(255)
  email String
  /// @zod .min(1).max(100)
  name  String?
}
```

Generated input schemas apply the declared Zod method chains.

`@zod` applies to `guard.input()` schemas, not `guard.model()` output schemas.

---

## Input validation

### Create vs update

```ts
const createUser = guard.input('User', {
  mode: 'create',
  pick: ['email', 'name'],
})

const updateUser = guard.input('User', {
  mode: 'update',
  pick: ['email', 'name'],
})
```

### Allow nulls

```ts
const updateUserNullable = guard.input('User', {
  mode: 'update',
  pick: ['name'],
  allowNull: true,
})
```

### Partial schemas

```ts
const patchUser = guard.input('User', {
  mode: 'update',
  pick: ['email', 'name'],
  partial: true,
})
```

### Refine overrides `@zod`

If you provide `refine`, it receives the base field schema and replaces the generated `@zod` chain behavior for that field.

```ts
const schema = guard.input('User', {
  mode: 'create',
  pick: ['email'],
  refine: {
    email: (base) => base.min(5).max(255),
  },
})
```

---

## Query shape enforcement

Shapes use Prisma-like syntax.

* `true` means the client may provide that value
* literal values mean the server forces that value

### Static shape

```ts
const findManyProjects = guard.query('Project', 'findMany', {
  where: {
    title: { contains: true },
  },
  orderBy: { title: true },
  take: { max: 100, default: 25 },
})
```

### Context-dependent shape

```ts
type AppContext = { tenantId: string }

const findAssignments = guard.query<AppContext>('Assignment', 'findMany', (ctx) => ({
  where: {
    tenantId: { equals: ctx.tenantId },
    title: { contains: true },
  },
  take: { max: 50, default: 20 },
}))
```

### Caller-based shapes

```ts
type AppContext = { tenantId: string }

const findProjects = guard.query<AppContext>('Project', 'findMany', {
  '/admin/projects': (ctx) => ({
    where: {
      tenantId: { equals: ctx.tenantId },
      title: { contains: true },
    },
    take: { max: 50, default: 20 },
  }),
  '/public/projects': {
    where: {
      title: { contains: true },
    },
    take: { max: 20, default: 10 },
  },
})
```

Client request:

```json
{
  "caller": "/admin/projects",
  "where": {
    "title": { "contains": "demo" }
  }
}
```

### Caller patterns

Parameterized callers are supported:

```text
/org/:orgId/users
/org/:orgId/users/:userId
```

Matching is case-sensitive. Parameters are routing-only and are not automatically extracted into context.

### Distinct support

```ts
const findUsers = guard.query('User', 'findMany', {
  where: {
    email: { contains: true },
  },
  distinct: ['email', 'name'],
  take: { max: 100, default: 50 },
})
```

---

## Supported query methods

* `findMany`
* `findFirst`
* `findFirstOrThrow`
* `findUnique`
* `findUniqueOrThrow`
* `count`
* `aggregate`
* `groupBy`

Known unsupported Prisma args:

* `having` for `groupBy`

---

## Automatic tenant isolation

Tenant predicates are injected into top-level scoped queries.

Input query:

```ts
await prisma.project.findFirst({
  where: { id: projectId },
})
```

Actual enforced condition:

```text
WHERE id = ?
AND tenantId = ?
```

This is the core security property of the extension runtime.

---

## findUnique behavior

Prisma `findUnique` only accepts declared unique selectors.

This is valid:

```ts
await prisma.project.findUnique({
  where: { id: projectId },
})
```

This is not generally valid unless declared as a composite unique:

```ts
where: {
  id: projectId,
  tenantId: tenantId,
}
```

Because of this, `prisma-guard` supports two modes.

### `findUniqueMode = "reject"` recommended

Scoped `findUnique` and `findUniqueOrThrow` are rejected.

Use `findFirst` instead:

```ts
await prisma.project.findFirst({
  where: { id: projectId },
})
```

This allows tenant scope to be enforced at query time.

### `findUniqueMode = "verify"`

The query runs first, then the result is verified against tenant scope.

If required foreign keys are missing from the result, a second verification query is performed.

This is weaker because:

* it is post-read verification
* it can require an extra query
* it has a TOCTOU race window

For tenant isolation, `"reject"` is the safer production default.

### Why reject is safer

`reject` prevents the weaker pattern:

```ts
await prisma.project.findUnique({
  where: { id: projectId },
})
```

and forces the safer pattern:

```ts
await prisma.project.findFirst({
  where: { id: projectId },
})
```

which the extension can scope directly.

---

## Security model

`prisma-guard` enforces three layers.

| Layer          | Purpose                        |
| -------------- | ------------------------------ |
| Input boundary | prevents invalid input         |
| Query boundary | restricts allowed query shapes |
| Data boundary  | injects tenant scope           |

These layers are complementary. Together they provide a fail-closed data boundary around Prisma usage.

---

## Limitations

These limitations are real and should be treated as part of the security model.

### Raw SQL bypasses guard protections

```ts
$queryRaw
$executeRaw
```

are not intercepted.

### Nested writes are not intercepted

Prisma extension hooks operate on top-level operations. Nested writes do not trigger separate scope interception.

Use query shape rules to restrict nested write paths you do not want to expose.

### `findUnique` cannot be safely scoped in Prisma extension mode

This is a Prisma API limitation, not a conceptual limitation of scoped unique lookups.

That is why `findUniqueMode = "reject"` is recommended.

### Composite foreign keys to scope roots are excluded

If a model references a scope root through composite foreign keys, it is treated as ambiguous and excluded from auto-scoping.

Handle these models explicitly via shape rules.

---

## Advanced: SQL-backed runtimes

The `findUnique` limitation exists in Prisma Client extension mode because Prisma requires a unique selector input type.

At the SQL level, scoped unique lookups are straightforward:

```sql
SELECT *
FROM "Project"
WHERE "id" = $1
  AND "tenantId" = $2
LIMIT 1
```

If your runtime controls SQL generation directly, it can enforce unique lookup plus tenant predicate in a single query.

Libraries like **prisma-sql** make this possible for advanced architectures.

Examples of safe scoped unique lookups in SQL-backed runtimes:

* `id + tenantId`
* `slug + tenantId`
* `externalId + tenantId`

This is an advanced integration path and separate from the standard Prisma extension runtime used by `prisma-guard`.

---

## Output shaping

`guard.model()` creates output schemas for validating and shaping returned data.

These schemas use base Prisma field types and do not apply `@zod` input constraints.

```ts
const userOutput = guard.model('User', {
  pick: ['id', 'email', 'name'],
  include: {
    profile: { pick: ['bio'] },
  },
  strict: true,
})
```

Notes:

* `pick` and `omit` apply to scalar fields
* relations must be added through `include`
* include depth defaults to 5 and can be overridden with `maxDepth`

---

## Error handling

`guard.input().parse()` and `guard.query().parse()` may throw:

* `ZodError` for Zod validation failures
* `ShapeError` for invalid shape usage or config
* `CallerError` for missing, unknown, or ambiguous caller
* `PolicyError` for denied scope or policy access

Shared guard errors include `status` and `code` properties for HTTP response mapping.

---

## How it works internally

`prisma-guard` has two main parts.

### 1. Generator

Runs during `prisma generate`.

It reads the Prisma DMMF and emits:

* `TYPE_MAP`
* `ENUM_MAP`
* `SCOPE_MAP`
* `ZOD_CHAINS`
* `GUARD_CONFIG`

These outputs are plain TypeScript and are meant to be compiled with your normal toolchain.

### 2. Runtime

At runtime:

* `guard.input()` builds Zod input schemas
* `guard.query()` builds query arg validators
* `guard.model()` builds output validators
* `guard.extension()` creates a Prisma extension for tenant scoping

The runtime prefers query-time enforcement over post-query verification whenever Prisma semantics allow it.

---

## Why this approach

Common alternatives have tradeoffs.

| Approach                         | Tradeoff                          |
| -------------------------------- | --------------------------------- |
| ad hoc route validation          | repetitive and inconsistent       |
| middleware-only filtering        | too easy to miss edge cases       |
| runtime reflection-heavy systems | slower and harder to reason about |
| full ORM replacement             | larger migration cost             |

`prisma-guard` focuses narrowly on **data boundaries**, not ORM replacement.

---

## Performance characteristics

The runtime does lightweight argument rewriting and Zod validation.

In most real applications, overhead should be negligible relative to database round-trip time.

Static shapes are compiled once and reused. Context-dependent shapes are rebuilt per parse because they depend on runtime context.

---

## Security philosophy

`prisma-guard` is designed to fail closed.

Examples:

| Condition                  | Behavior           |
| -------------------------- | ------------------ |
| ambiguous scope mapping    | error by default   |
| missing scope context      | error by default   |
| unsafe scoped `findUnique` | reject recommended |
| invalid `@zod` directive   | error by default   |

This avoids silent security degradation.

---

## Recommended production configuration

```prisma
generator guard {
  provider                = "prisma-guard"
  output                  = "generated/guard"
  onInvalidZod            = "error"
  onAmbiguousScope        = "error"
  onMissingScopeContext   = "error"
  findUniqueMode          = "reject"
}
```

These settings are the strongest and safest defaults for multi-tenant production systems.

---

## When to use prisma-guard

Best fit:

* multi-tenant SaaS backends
* Prisma-based microservices
* RPC / internal API backends
* systems that want schema-driven validation and scoping

Less suitable:

* raw SQL-heavy systems
* architectures that bypass Prisma Client
* cases where another layer already owns validation and authorization comprehensively

---

## Version compatibility

Supported Prisma versions:

```text
Prisma 6
Prisma 7
```

Supported Node versions:

```text
Node 20
Node 22
```

Your CI should test the matrix you officially support.

---

## Design principles

1. Fail closed on ambiguous security conditions
2. Prefer query-time enforcement over verification
3. Generate minimal runtime metadata
4. Avoid automatic relation traversal
5. Keep scope rules explicit and schema-driven

---

## Comparison

| Feature                                    | prisma-guard | raw Prisma  |
| ------------------------------------------ | ------------ | ----------- |
| Input validation                           | yes          | no          |
| Query shape enforcement                    | yes          | no          |
| Automatic tenant scoping                   | yes          | no          |
| Safe scoped `findUnique` in extension mode | reject       | not handled |
| Schema-driven rules                        | yes          | no          |

---

## Roadmap

Possible future improvements:

* optional nested-write enforcement helpers
* richer relation-level policies
* more query method coverage
* adapter integrations for SQL-backed runtimes

---

## License

MIT