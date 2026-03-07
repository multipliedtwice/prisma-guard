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
.guard(shape)
      ↓
validated input + allowed query shape
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
* [The guard API](#the-guard-api)
* [Named shapes and caller routing](#named-shapes-and-caller-routing)
* [Context-dependent shapes](#context-dependent-shapes)
* [Automatic tenant isolation](#automatic-tenant-isolation)
* [findUnique behavior](#findunique-behavior)
* [Output shaping](#output-shaping)
* [Security model](#security-model)
* [Limitations](#limitations)
* [Advanced: SQL-backed runtimes](#advanced-sql-backed-runtimes)
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

A client-controlled include chain can traverse relations and select sensitive fields from unrelated models:
```ts
await prisma.project.findMany({
  include: {
    tasks: {
      include: {
        comments: {
          include: {
            author: {
              select: {
                email: true,
                passwordHash: true,
                resetToken: true,
              },
            },
          },
        },
      },
    },
  },
})
```

### Tenant isolation bugs
```ts
await prisma.project.findFirst({
  where: { id: { equals: projectId } },
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

`prisma-guard` sits between your application and Prisma Client. The `.guard(shape)` call defines the boundary; the chained Prisma method validates and executes in one step.
```text
┌───────────────┐
│   Client      │
│  (API / RPC)  │
└───────┬───────┘
        │ request
        ▼
┌──────────────────────┐
│   .guard(shape)       │
│  validates input +    │
│  enforces query shape │
└─────────┬────────────┘
          │ validated args
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

---

## Install
```bash
npm install prisma-guard zod @prisma/client
```

Peer dependencies:

* `zod ^4`
* `@prisma/client ^6 || ^7`

Both `zod` and `@prisma/client` must be installed before running `prisma generate`. The generator validates `@zod` directives against real Zod schemas at generation time.

Generated output files (`index.ts`, `client.ts`) are TypeScript. A TypeScript-capable build pipeline is required.

The generated output uses `.js` extension imports in TypeScript source (e.g. `import { ... } from './index.js'`). This requires ESM-aware module resolution in your TypeScript config — either `"moduleResolution": "NodeNext"` or `"moduleResolution": "Bundler"` in `tsconfig.json`. The classic `"moduleResolution": "node"` setting is not compatible.

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

This emits a ready-to-use `client.ts` with all type mappings and a pre-wired guard instance.

### 3. Set up the Prisma client
```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient } from '@prisma/client'
import { guard } from './generated/guard/client'

const store = new AsyncLocalStorage<{ tenantId: string }>()

const prisma = new PrismaClient().$extends(
  guard.extension(() => ({
    Tenant: store.getStore()?.tenantId,
  }))
)
```

### 4. Use it
```ts
await prisma.project
  .guard({
    data: { title: true },
  })
  .create({ data: req.body })

await prisma.project
  .guard({
    where: { title: { contains: true } },
    orderBy: { title: true },
    take: { max: 50, default: 20 },
  })
  .findMany(req.body)
```

That's it. Input is validated, query shape is enforced, tenant scope is injected. All in one chain.

---

## Before / After prisma-guard

### Without prisma-guard
```ts
await prisma.project.create({
  data: req.body,
})

await prisma.project.findMany(req.query)

await prisma.project.findFirst({
  where: { id: { equals: projectId } },
})
```

Problems:

* unvalidated input
* unrestricted query shape
* missing tenant filter

### With prisma-guard
```ts
await prisma.project
  .guard({ data: { title: true } })
  .create({ data: req.body })

await prisma.project
  .guard({
    where: { title: { contains: true } },
    take: { max: 50, default: 20 },
  })
  .findMany(req.body)

await prisma.project
  .guard({
    where: { id: { equals: true } },
  })
  .findFirst({ where: { id: { equals: projectId } } })
```

| Risk                | Mitigation                                       |
| ------------------- | ------------------------------------------------ |
| arbitrary input     | `data` shape restricts writable fields + Zod     |
| expensive queries   | shape whitelist on where, include, take, orderBy  |
| cross-tenant access | automatic scope injection via extension           |

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

If a model has multiple foreign keys to the same scope root, it is excluded from the auto-scope map when `onAmbiguousScope` is `"warn"` or `"ignore"`, and causes a generation error when `onAmbiguousScope` is `"error"` (the default).

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

`@zod` chains apply automatically when the field appears in a `data` shape.

`@zod` directives are validated during `prisma generate`. The generator validates directive syntax, checks that each chained method exists on the field's Zod base type, and attempts to construct the full chain. Invalid chains — such as `.email()` on a Boolean field or `.min("abc")` on a String field — fail generation with a clear error message. Note: some argument-level type mismatches may only be caught if Zod throws at schema construction time. The `@zod` DSL supports a restricted subset of Zod methods, not arbitrary chaining.

For list fields, `@zod` chains apply to the `z.array(...)` schema, not to individual elements. For example, `.min(1)` on a `String[]` field enforces a minimum array length of 1, not a minimum string length.

### `refine` replaces `@zod` chains

When using `guard.input()` with a `refine` callback for a field, the callback receives the **base** Zod type (without `@zod` chains applied). The `@zod` chain for that field is bypassed entirely. This is by design — `refine` is a full override, not a modifier on top of `@zod`.
```ts
guard.input('User', {
  refine: {
    email: (base) => base.email().max(320),
  },
})
```

In this example, any `@zod` directive on the `email` field in the Prisma schema is ignored. The `refine` callback is the sole source of validation for that field.

---

## The guard API

`.guard(shape)` is available on every model delegate. It returns an object with all Prisma methods. The shape defines the boundary; the method validates and executes.

### Shape syntax

* `true` — the client may provide this value
* literal value — the server forces this value

### Reads
```ts
await prisma.project
  .guard({
    where: { title: { contains: true } },
    orderBy: { title: true },
    take: { max: 100, default: 25 },
  })
  .findMany(req.body)
```

The client can only filter by `title`, sort by `title`, and take up to 100 rows. Everything else is rejected.

### Creates
```ts
await prisma.project
  .guard({
    data: { title: true, status: true },
  })
  .create({ data: req.body })
```

Only `title` and `status` are accepted from the client. `@zod` chains apply automatically.

For create operations, guard validates that all required fields without defaults are accounted for in the data shape — either as client-allowed (`true`), forced (literal value), or as scope foreign keys that the scope extension will inject automatically. If a required non-default field is missing from the shape and is not a scope FK, guard throws `ShapeError` at shape evaluation time.

### Updates
```ts
await prisma.project
  .guard({
    data: { title: true },
    where: { id: { equals: true } },
  })
  .update({
    data: { title: 'New title' },
    where: { id: { equals: 'abc123' } },
  })
```

In update mode, all `data` fields are optional. The `where` shape enforces which filters the client can use.

### Forced values

Literal values in the shape are forced by the server and cannot be overridden by the client:
```ts
await prisma.project
  .guard({
    data: { title: true, status: 'draft' },
  })
  .create({ data: req.body })
```

`status` is always `'draft'` regardless of what the client sends.

The same applies to `where`:
```ts
await prisma.project
  .guard({
    where: {
      status: { equals: 'published' },
      title: { contains: true },
    },
  })
  .findMany(req.body)
```

`status = 'published'` is always enforced. The client can only control the `title` filter.

### Deletes
```ts
await prisma.project
  .guard({
    where: { id: { equals: true } },
  })
  .delete({ where: { id: { equals: 'abc123' } } })
```

`data` is not valid for delete shapes.

### Batch creates
```ts
await prisma.project
  .guard({
    data: { title: true, status: true },
  })
  .createMany({
    data: [
      { title: 'Project A', status: 'active' },
      { title: 'Project B', status: 'draft' },
    ],
  })
```

Each item in the array is validated against the same data shape.

In guarded mode, `createMany` and `createManyAndReturn` require `data` to be an array. Single-object data is not silently wrapped.

### Bulk mutations

`updateMany`, `updateManyAndReturn`, and `deleteMany` require a `where` shape in the guard definition. This prevents accidental unconstrained bulk writes.
```ts
await prisma.project
  .guard({
    data: { status: true },
    where: { status: { equals: true } },
  })
  .updateMany({
    data: { status: 'archived' },
    where: { status: { equals: 'draft' } },
  })
```

A guard shape without `where` on a bulk mutation method throws `ShapeError`. Additionally, if the client provides no where conditions at runtime (or the resolved where is empty), the request is rejected. Each where operator object must contain at least one operator with a value — empty operator objects like `{ status: {} }` are rejected.

### Mutation body validation

Mutation bodies are strictly validated. Only expected keys are accepted:

* `create`, `createMany`, `createManyAndReturn`: `data`
* `update`, `updateMany`, `updateManyAndReturn`: `data`, `where`
* `delete`, `deleteMany`: `where`

Unknown keys — including `select` and `include` — are rejected with `ShapeError`. Mutation methods do not support `select` or `include` in the guard body. Single-record mutations (`create`, `update`, `delete`) return the full record. Batch mutations (`createMany`, `updateMany`, `deleteMany`) return a `BatchPayload` (count). `createManyAndReturn` and `updateManyAndReturn` return arrays of records.

Guard shape keys are also validated per method:

* create methods accept only `data`
* update methods accept only `data` and `where`
* delete methods accept only `where`

Shape keys not valid for the method (e.g. `include` on a create shape) throw `ShapeError`.

### Supported shape keys

For reads: `where`, `include`, `select`, `orderBy`, `cursor`, `take`, `skip`, `distinct`, `_count`, `_avg`, `_sum`, `_min`, `_max`, `by`, `having`

For writes: `data`, `where`

### Supported methods

Reads: `findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `count`, `aggregate`, `groupBy`

Writes: `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn`, `delete`, `deleteMany`

---

## Named shapes and caller routing

Different pages or API consumers often need different shapes for the same model. Named shapes route requests to the right shape based on a `caller` field.

Caller keys must not collide with reserved shape config keys (`where`, `data`, `include`, `select`, `orderBy`, etc.). Using a reserved key as a caller path throws `ShapeError`.

### Define named shapes
```ts
await prisma.project
  .guard({
    '/admin/projects': {
      where: { title: { contains: true }, status: { equals: true } },
      take: { max: 100 },
    },
    '/public/projects': {
      where: { title: { contains: true } },
      take: { max: 20, default: 10 },
    },
  })
  .findMany({
    caller: req.headers['x-caller'],
    ...req.body,
  })
```

The frontend sends its current route as a header:
```ts
fetch('/api/projects', {
  headers: { 'x-caller': window.location.pathname },
  body: JSON.stringify({
    where: { title: { contains: 'demo' } },
  }),
})
```

The backend extracts `caller` from the body, matches it against the shape map, strips it, and validates the rest.

### Named mutation shapes
```ts
await prisma.project
  .guard({
    '/admin/projects/:id': {
      data: { title: true, status: true, priority: true },
      where: { id: { equals: true } },
    },
    '/editor/projects/:id': {
      data: { title: true },
      where: { id: { equals: true } },
    },
  })
  .update({
    caller: req.headers['x-caller'],
    data: req.body.data,
    where: { id: { equals: req.params.id } },
  })
```

### Parameterized caller patterns
```text
/org/:orgId/users
/org/:orgId/users/:userId
```

Matching is case-sensitive. Exact matches are checked first. If no exact match is found, parameterized patterns are evaluated. Parameters are routing-only and are not extracted into context.

### Fail-closed behavior

If `caller` is missing or doesn't match any pattern, the request is rejected with a `CallerError`. If a caller matches multiple parameterized patterns, it is also rejected with a `CallerError`.

---

## Context-dependent shapes

Shapes can be functions that receive the context provided to `guard.extension()`. This is the same context used for tenant scoping — no separate mechanism.
```ts
const prisma = new PrismaClient().$extends(
  guard.extension(() => ({
    Tenant: store.getStore()?.tenantId,
    role: store.getStore()?.role,
  }))
)
```

The context function returns an object with arbitrary keys. Keys whose values are `string`, `number`, or `bigint` are used as scope context for tenant isolation. Other keys (like `role` in the example above) are passed through to shape functions but are not used for scoping.

### Single context-dependent shape
```ts
await prisma.project
  .guard((ctx) => ({
    where: {
      tenantId: { equals: ctx.Tenant },
      title: { contains: true },
    },
    take: ctx.role === 'admin' ? { max: 100 } : { max: 20 },
  }))
  .findMany(req.body)
```

### Named context-dependent shapes
```ts
await prisma.project
  .guard({
    '/admin/projects': (ctx) => ({
      where: {
        tenantId: { equals: ctx.Tenant },
        title: { contains: true },
      },
      take: { max: 100 },
    }),
    '/public/projects': {
      where: { title: { contains: true } },
      take: { max: 20 },
    },
  })
  .findMany({
    caller: req.headers['x-caller'],
    ...req.body,
  })
```

Static shapes and function shapes can be mixed freely in the same shape map.

---

## Automatic tenant isolation

Tenant predicates are injected into top-level scoped queries only. Nested reads via `include` or `select` and nested writes are **not** automatically scoped by the extension. See [Limitations](#limitations) for details.

Input query:
```ts
await prisma.project
  .guard({ where: { id: { equals: true } } })
  .findFirst({ where: { id: { equals: projectId } } })
```

Actual enforced condition:
```text
WHERE id = ?
AND tenantId = ?
```

This applies to all top-level operations on scoped models, including reads, writes, and deletes.

### What is scoped

* All top-level reads (`findMany`, `findFirst`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`)
* All top-level creates (`create`, `createMany`, `createManyAndReturn`) — scope FK is injected into data
* All top-level unique mutations (`update`, `delete`) — scope condition is merged into where
* All top-level bulk mutations (`updateMany`, `updateManyAndReturn`, `deleteMany`) — scope condition is merged into where, scope FK is stripped from data

### What is NOT scoped

* Nested reads loaded via `include` or `select` — use forced where conditions in the shape to restrict these
* Nested writes — Prisma extension hooks operate on top-level operations only
* `$queryRaw` and `$executeRaw` — raw SQL bypasses all guard protections
* `upsert` on scoped models — rejected with `PolicyError`; handle explicitly in route logic

### Scope relation writes

When a mutation includes data for a scoped model, the scope extension manages the foreign key field automatically. The `onScopeRelationWrite` generator config controls what happens if the mutation data also includes the Prisma relation field (e.g. writing `tenant: { connect: { id: '...' } }` alongside the managed `tenantId` FK):

| Value     | Behavior                                              |
| --------- | ----------------------------------------------------- |
| `"error"` | Reject with `ShapeError` (default)                    |
| `"warn"`  | Remove the relation field and log a warning           |
| `"strip"` | Remove the relation field silently                    |

This setting is configured in the generator block:
```prisma
generator guard {
  provider              = "prisma-guard"
  output                = "generated/guard"
  onScopeRelationWrite  = "error"
}
```

---

## findUnique behavior

Prisma `findUnique` only accepts declared unique selectors.

This is valid:
```ts
await prisma.project.findUnique({
  where: { id: { equals: projectId } },
})
```

This is not generally valid unless declared as a composite unique:
```ts
where: {
  id: { equals: projectId },
  tenantId: { equals: tenantId },
}
```

Because of this, `prisma-guard` supports two modes.

### `findUniqueMode = "reject"` recommended

Scoped `findUnique` and `findUniqueOrThrow` are rejected.

Use `findFirst` instead:
```ts
await prisma.project
  .guard({ where: { id: { equals: true } } })
  .findFirst({ where: { id: { equals: projectId } } })
```

This allows tenant scope to be enforced at query time.

### `findUniqueMode = "verify"`

The query runs first, then the result is verified against tenant scope.

This is weaker because:

* it is post-read verification
* it can require an extra query
* it has a TOCTOU race window

For tenant isolation, `"reject"` is the safer production default.

---

## Output shaping

`guard.model()` creates output schemas for validating and shaping returned data.

These schemas use base Prisma field types and do not apply `@zod` input constraints. This is intentional — `@zod` directives define input validation rules (e.g. `.email()`, `.min(1)`) that are not meaningful for validating data already stored in the database.
```ts
const userOutput = guard.model('User', {
  pick: ['id', 'email', 'name'],
  include: {
    profile: { pick: ['bio'] },
  },
  strict: true,
})
```

`guard.model()` produces a non-strict schema by default, meaning extra fields in the data are passed through without error. For output validation where extra fields should be rejected, pass `strict: true` as shown above.

Notes:

* `pick` and `omit` apply to scalar fields and are mutually exclusive — passing both throws `ShapeError`
* relations must be added through `include`
* include depth defaults to 5 and can be overridden with `maxDepth`
* models may appear more than once in the include tree (e.g. `User → posts → author`) as long as the total depth does not exceed `maxDepth`

---

## Security model

`prisma-guard` enforces three layers.

| Layer          | Purpose                        |
| -------------- | ------------------------------ |
| Input boundary | prevents invalid input         |
| Query boundary | restricts allowed query shapes |
| Data boundary  | injects tenant scope           |

These layers are complementary. Together they provide a fail-closed data boundary around Prisma usage at the **top-level operation** only. Nested reads and writes are not intercepted by the scope layer — see [Limitations](#limitations).

---

## Limitations

These limitations are real and should be treated as part of the security model.

### Raw SQL bypasses guard protections

`$queryRaw` and `$executeRaw` are not intercepted.

### Nested writes are not intercepted

Prisma extension hooks operate on top-level operations. Nested writes do not trigger separate scope interception.

Use query shape rules to restrict nested write paths you do not want to expose.

### Nested reads via include are not scope-filtered

The scope extension operates on the top-level operation only. If a query uses `include` or `select` to load a relation that is itself a scoped model, the nested results are not tenant-filtered by the extension. Use forced where conditions in the include/select shape to restrict nested reads.

### `findUnique` cannot be safely scoped in Prisma extension mode

This is a Prisma API limitation, not a conceptual limitation of scoped unique lookups.

That is why `findUniqueMode = "reject"` is recommended.

### Composite foreign keys to scope roots

If a model references a scope root through composite foreign keys, it is excluded from the auto-scope map when `onAmbiguousScope` is `"warn"` or `"ignore"`, and causes a generation error when `onAmbiguousScope` is `"error"` (the default).

Handle these models explicitly via shape rules.

### No logical combinators in where shapes

Guard `where` shapes define field-level operator filters. Logical combinators (`AND`, `OR`, `NOT`) are not supported in shape definitions. These are Prisma client-side features that cannot be meaningfully restricted through a static shape.

If you need logical combinators, use context-dependent shapes to construct the full where condition server-side.

### No relation filters in where shapes

Guard `where` shapes only support scalar field filters. Relation-level filters (e.g. `posts: { some: { ... } }`) are not supported.

### Cursor fields must cover a unique constraint

Prisma requires cursor-based pagination to use uniquely-identifiable fields. Guard enforces this at shape construction time: cursor fields must cover at least one unique constraint from the model. Non-unique cursor shapes are rejected with `ShapeError`.

### `@zod` on list fields applies to the array

`@zod` directives on list fields (e.g. `String[]`) apply to the `z.array(...)` schema, not to individual elements. For example, `.min(1)` on a `String[]` field enforces a minimum array length of 1, not a minimum string length per element.

### Mutation methods do not support `select` or `include`

`create`, `update`, `delete` and their batch/many variants do not accept `select` or `include` in the guard body. Passing either is rejected with `ShapeError`. Single-record mutations (`create`, `update`, `delete`) return the full record. Batch mutations (`createMany`, `updateMany`, `deleteMany`) return a `BatchPayload`. `createManyAndReturn` and `updateManyAndReturn` return arrays of records. This may change in a future version.

### Generated output is TypeScript with ESM imports

The generator writes `index.ts` and `client.ts` using `.js` extension imports. A TypeScript-capable build pipeline with ESM-aware module resolution is required (`"moduleResolution": "NodeNext"` or `"Bundler"` in `tsconfig.json`). The classic `"moduleResolution": "node"` setting is not compatible.

### `having` is limited to scalar fields

Guard `having` shapes support scalar field filters with their type-appropriate operators. Aggregate-level having expressions (e.g. `_count`, `_avg` inside having) are not supported.

### Json fields accept any JSON-serializable value

`Json` fields are recursively validated as JSON-serializable values (string, number, boolean, null, plain objects, arrays). Values that are not JSON-serializable — including `undefined`, functions, symbols, class instances (such as `Date`), `NaN`, and `Infinity` — are rejected. This does not enforce any particular JSON structure. If you need structured JSON validation, use a context-dependent shape or validate before calling guard.

### `refine` replaces `@zod` chains

When a `refine` callback is provided for a field in `guard.input()`, the callback receives the base Zod type without `@zod` chains. The `@zod` directive for that field is bypassed entirely. See [Schema annotations](#refine-replaces-zod-chains).

### `pick` and `omit` are mutually exclusive

Both `guard.input()` and `guard.model()` reject configurations that specify both `pick` and `omit`. This is enforced at both the type level and at runtime.

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

---

## Error handling

`.guard(shape).method(body)` may throw:

* `ZodError` — Zod validation failures on data or query args
* `ShapeError` — invalid shape config, unknown shape config keys, wrong method for shape, body format issues, unexpected body keys, or incomplete create data shapes
* `CallerError` — missing, unknown, or ambiguous caller in named shapes
* `PolicyError` — denied scope, missing tenant context, or rejected operations on scoped models (e.g. upsert, findUnique in reject mode)

All guard errors include `status` and `code` properties for HTTP response mapping:

| Error         | status | code             |
| ------------- | ------ | ---------------- |
| `ShapeError`  | 400    | `SHAPE_INVALID`  |
| `CallerError` | 400    | `CALLER_UNKNOWN` |
| `PolicyError` | 403    | `POLICY_DENIED`  |

---

## How it works internally

`prisma-guard` has two main parts.

### 1. Generator

Runs during `prisma generate`. Requires `zod` and `@prisma/client` to be installed.

It reads the Prisma DMMF and emits:

* `TYPE_MAP` — field metadata per model
* `ENUM_MAP` — enum values
* `SCOPE_MAP` — foreign key → scope root mappings
* `ZOD_CHAINS` — `@zod` directive chains (validated against real Zod base types at generation time)
* `GUARD_CONFIG` — generator config values
* `UNIQUE_MAP` — unique constraint metadata per model
* `client.ts` — pre-wired guard instance with typed model extensions

### 2. Runtime

At runtime, `guard.extension()` creates a Prisma extension that provides:

* `.guard(shape)` on every model delegate — validates input, enforces query shapes, returns typed Prisma methods
* `$allOperations` query hook — injects tenant scope into every top-level database operation

The `.guard()` call validates against the shape, merges forced values, and delegates to the underlying Prisma method. The scope layer runs transparently underneath.

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

Static shapes (both single and named) are cached per guard instance and method. In a named shape map, each static entry is cached independently — a map with 9 static entries and 1 context-dependent entry will cache the 9 static entries. Context-dependent shapes (functions) resolve the function on each call because they depend on runtime context and are never cached.

---

## Security philosophy

`prisma-guard` is designed to fail closed.

| Condition                              | Behavior                                              |
| -------------------------------------- | ----------------------------------------------------- |
| ambiguous scope mapping                | error by default                                      |
| missing scope context                  | error by default                                      |
| `onMissingScopeContext = "ignore"`      | scope bypassed for missing roots; present roots still enforced |
| unsafe scoped `findUnique`             | reject recommended                                    |
| invalid `@zod` directive               | error by default                                      |
| missing `caller` in named shapes       | error always                                          |
| `data` in read shape                   | error always                                          |
| missing `data` in write shape          | error always                                          |
| bulk mutation without `where` shape    | error always                                          |
| bulk mutation with empty `where`       | error always                                          |
| upsert on scoped model                 | error always                                          |
| unexpected keys in mutation body       | error always                                          |
| unknown keys in shape config           | error always                                          |
| cursor not covering unique constraint  | error always                                          |
| caller key collides with shape config  | error always                                          |
| empty operator objects in where        | error always                                          |
| `pick` and `omit` both specified       | error always                                          |
| scope relation in mutation data        | controlled by `onScopeRelationWrite` (default: error) |
| incomplete create data shape           | error always                                          |

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
  onScopeRelationWrite    = "error"
}
```

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

---

## Design principles

1. Fail closed on ambiguous security conditions
2. Prefer query-time enforcement over verification
3. Generate minimal runtime metadata
4. Avoid automatic relation traversal
5. Keep scope rules explicit and schema-driven
6. One chain — shape defines the boundary, method executes

---

## Comparison

| Feature                                    | prisma-guard   | raw Prisma  |
| ------------------------------------------ | -------------- | ----------- |
| Input validation                           | yes            | no          |
| Query shape enforcement                    | yes            | no          |
| Automatic tenant scoping (top-level)       | yes            | no          |
| Safe scoped `findUnique` in extension mode | reject         | not handled |
| Schema-driven rules                        | yes            | no          |
| Caller-based shape routing                 | yes            | no          |
| Typed method chaining                      | yes            | n/a         |
| Bulk mutation safety                       | required where | not handled |
| Mutation body validation                   | strict keys    | no          |
| Shape config validation                    | strict keys    | n/a         |
| Create completeness validation             | yes            | no          |

---

## Roadmap

Possible future improvements:

* `select`/`include` support for mutation return values
* optional nested-write enforcement helpers
* richer relation-level policies
* logical combinator support in where shapes (`AND`/`OR`/`NOT`)
* relation-level where filters
* more query method coverage
* adapter integrations for SQL-backed runtimes
* model-specific generated types for stronger compile-time shape validation
* structured JSON field validation via schema annotations

---

## License

MIT