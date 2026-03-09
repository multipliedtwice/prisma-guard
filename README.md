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
* [Logical combinators in where shapes](#logical-combinators-in-where-shapes)
* [Relation filters in where shapes](#relation-filters-in-where-shapes)
* [Mutation return projection](#mutation-return-projection)
* [Named shapes and caller routing](#named-shapes-and-caller-routing)
* [Context-dependent shapes](#context-dependent-shapes)
* [Automatic tenant isolation](#automatic-tenant-isolation)
* [Multi-root scope behavior](#multi-root-scope-behavior)
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

Models with a single unambiguous foreign key to a scope root are auto-scoped. A model can be scoped by multiple roots if it has foreign keys to different scope root models — see [Multi-root scope behavior](#multi-root-scope-behavior).

If a model has multiple foreign keys to the same scope root, the ambiguous root is excluded from that model's scope entries when `onAmbiguousScope` is `"warn"` or `"ignore"`, and causes a generation error when `onAmbiguousScope` is `"error"` (the default). Other non-ambiguous roots on the same model are still auto-scoped.

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

`@zod` chains apply automatically when the field appears in a `data` shape with `true`.

`@zod` directives are validated during `prisma generate`. The generator validates directive syntax, checks that each chained method is in the allowed list, and verifies method compatibility by advancing through the chain. Type-changing methods (such as `.nullable()`, `.optional()`, `.default()`) advance the schema type, so a chain like `.nullable().email()` is correctly rejected if `.email()` does not exist on the nullable wrapper. Note: some argument-level type mismatches may only be caught if Zod throws at schema construction time.

For list fields, `@zod` chains apply to the `z.array(...)` schema, not to individual elements. For example, `.min(1)` on a `String[]` field enforces a minimum array length of 1, not a minimum string length.

### Supported `@zod` methods

The `@zod` DSL supports a restricted subset of Zod methods. These are the allowed methods:

**String validations:** `min`, `max`, `length`, `email`, `url`, `uuid`, `cuid`, `cuid2`, `ulid`, `trim`, `toLowerCase`, `toUpperCase`, `startsWith`, `endsWith`, `includes`, `regex`, `datetime`, `ip`, `cidr`, `date`, `time`, `duration`, `base64`, `nanoid`, `emoji`

**Number validations:** `int`, `positive`, `nonnegative`, `negative`, `nonpositive`, `finite`, `safe`, `multipleOf`, `step`, `gt`, `gte`, `lt`, `lte`

**Array validations:** `min`, `max`, `length`, `nonempty`

**Field modifiers:** `optional`, `nullable`, `nullish`, `default`, `catch`, `readonly`

Note on field modifiers: prisma-guard already handles `optional` and `nullable` based on Prisma field metadata (`isRequired`, `hasDefault`). Adding `@zod .optional()` or `@zod .nullable()` explicitly will apply the Zod method on top of what prisma-guard already does, which may cause double-wrapping. Use these only when you need to override prisma-guard's default behavior.

Note on `default`: a `@zod .default(...)` chain adds a Zod-level default, which means Zod will fill in the value if it's undefined. The generator detects `.default()` in chains and emits a `ZOD_DEFAULTS` map. The create completeness check honors both Prisma's `@default` attribute and `@zod .default(...)` — a required field with either source of default is not flagged as missing from create data shapes. Prisma's `@default` remains the primary source of truth; `@zod .default(...)` is an additional signal.

Note on chain ordering: type-changing methods like `.nullable()`, `.optional()`, `.default()`, and `.catch()` alter the wrapper type. Methods that follow a type-changing method must exist on the resulting wrapper, not on the original base type. For example, `.email().nullable()` is valid (`.email()` returns a string schema, `.nullable()` wraps it), but `.nullable().email()` is invalid (`.nullable()` returns a nullable wrapper that does not have `.email()`).

### Supported argument types in `@zod` directives

The directive parser accepts these argument types: strings (`'hello'`, `"hello"`), numbers (`42`, `-3.14`, `1e2`), booleans (`true`, `false`), arrays (`[1, 2, 3]`), regex literals (`/^[a-z]+$/i`), and object literals (`{offset: true}`). Identifiers, template literals, `null`, `NaN`, `Infinity`, and function calls are not allowed.

### `refine` replaces `@zod` chains

Both `guard.input({ refine })` and inline refine functions in `data` shapes bypass `@zod` chains. The function receives the **base** Zod type (without `@zod` chains applied). This is by design — refine is a full override, not a modifier on top of `@zod`.
```ts
guard.input('User', {
  refine: {
    email: (base) => base.email().max(320),
  },
})
```

In this example, any `@zod` directive on the `email` field in the Prisma schema is ignored. The `refine` callback is the sole source of validation for that field.

Refine callbacks and inline refine functions must return a valid Zod schema. If the callback throws or returns a non-Zod value, a `ShapeError` is raised.

---

## The guard API

`.guard(shape)` is available on every model delegate. It returns an object with all Prisma methods. The shape defines the boundary; the method validates and executes.

### Data shape syntax

Each field in a `data` shape accepts one of three value types:

* `true` — the client may provide this value; `@zod` chains apply automatically
* literal value — the server forces this value; the client cannot override it
* function `(base) => schema` — the client may provide this value; the function receives the base Zod type (without `@zod` chains) and returns a refined schema
```ts
await prisma.project
  .guard({
    data: {
      title: (base) => base.min(1, 'Title required').max(200),
      status: true,
      priority: (base) => base.refine(v => v >= 1 && v <= 5, 'Priority 1-5'),
      createdBy: currentUserId,
    },
  })
  .create({ data: req.body })
```

In this example, `title` and `priority` use inline refines for custom validation and error messages, `status` uses `@zod` chains from the Prisma schema, and `createdBy` is forced to `currentUserId` regardless of client input.

Relation fields are not permitted in `data` shapes. Attempting to use a relation field in a data shape throws `ShapeError`. See [Limitations](#guarded-data-shapes-do-not-permit-relation-fields).

### Query shape syntax

For read operations, `true` means the client may provide this value and literal values are forced:

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

For create operations, guard validates that all required fields without defaults are accounted for in the data shape — either as client-allowed (`true` or function), forced (literal value), as scope foreign keys that the scope extension will inject automatically, or as fields with a `@zod .default(...)` directive. If a required field is missing from the shape and has no Prisma `@default`, no `@zod .default(...)`, and is not a scope FK, guard throws `ShapeError` at shape evaluation time.

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

Forced where conditions are conflict-checked during shape construction. If the same field and operator appear with different forced values in different parts of a shape (e.g. at the top level and inside a combinator), the shape is rejected with `ShapeError`. This prevents ambiguous security configurations where one forced value would silently overwrite another.

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

`createMany` and `createManyAndReturn` also accept `skipDuplicates: boolean` in the request body. This is passed through to Prisma without shape-level configuration.

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

Mutation bodies are strictly validated. The accepted keys depend on whether the shape defines a return projection (`select` or `include`):

Without projection in shape:

* `create`: `data`
* `createMany`, `createManyAndReturn`: `data`, `skipDuplicates`
* `update`, `updateMany`, `updateManyAndReturn`: `data`, `where`
* `delete`, `deleteMany`: `where`

With projection in shape (methods that support it):

* `create`: `data`, `select`, `include`
* `createManyAndReturn`: `data`, `select`, `include`, `skipDuplicates`
* `update`, `updateManyAndReturn`: `data`, `where`, `select`, `include`
* `delete`: `where`, `select`, `include`

For `createMany` and `createManyAndReturn`, `skipDuplicates` is also accepted as a body key. It must be a boolean if provided.

Unknown keys are rejected with `ShapeError`. If the body contains `select` or `include` but the shape does not define them, the request is rejected.

Guard shape keys are also validated per method:

* create methods accept `data`, and optionally `select`/`include` (if the method supports projection)
* update methods accept `data`, `where`, and optionally `select`/`include`
* delete methods accept `where`, and optionally `select`/`include`

Shape keys not valid for the method throw `ShapeError`.

### Supported shape keys

For reads: `where`, `include`, `select`, `orderBy`, `cursor`, `take`, `skip`, `distinct`, `_count`, `_avg`, `_sum`, `_min`, `_max`, `by`, `having`

For writes: `data`, `where`, `select`, `include` (select/include only on methods that return records)

Where shapes accept scalar field filters, relation filters (`some`, `every`, `none`, `is`, `isNot`), and logical combinators (`AND`, `OR`, `NOT`).

### Where DSL is a constrained Prisma subset

The where shape syntax supports a subset of Prisma's where filter API. Notable differences from raw Prisma where clauses:

* The `not` operator accepts a scalar value only, not a nested filter object. Prisma's `{ not: { gt: 5 } }` form is not supported.
* `AND` and `OR` in client input must be arrays. Prisma accepts a single object for `AND`; prisma-guard requires an array.
* Relation filter operators (`some`, `every`, `none`, `is`, `isNot`) require at least one nested condition when all conditions are client-controlled. Empty relation filters like `{ posts: { some: {} } }` are rejected.
* Relation operator containers require at least one operator when no forced values are present. `{ posts: {} }` is rejected.
* Forced where conditions are conflict-checked at shape construction time. The same field and operator with different forced values across shape branches (e.g. top-level vs inside a combinator) is rejected with `ShapeError`.

These restrictions are intentional. They prevent clients from sending structurally valid but semantically vacuous filters that could broaden query scope, particularly in bulk mutation where clauses.

### Supported methods

Reads: `findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `count`, `aggregate`, `groupBy`

Writes: `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn`, `delete`, `deleteMany`

---

## Logical combinators in where shapes

Where shapes support `AND`, `OR`, and `NOT` to compose filter conditions. The combinator value is a where config defining allowed fields inside the combinator:
```ts
await prisma.project
  .guard({
    where: {
      OR: {
        title: { contains: true },
        description: { contains: true },
      },
    },
    take: { max: 50 },
  })
  .findMany({
    where: {
      OR: [
        { title: { contains: 'demo' } },
        { description: { contains: 'demo' } },
      ],
    },
  })
```

The shape defines which fields are allowed inside each combinator. The client sends arrays for `AND`/`OR` and an object or array for `NOT`.

Forced values inside combinators are lifted to the top-level query as AND conditions, regardless of the combinator type. This means a forced value inside an `OR` shape does not become an OR branch — it becomes an additional AND constraint on the entire query. This is consistent with the fail-closed design: forced values always restrict, never broaden.
```ts
await prisma.project
  .guard({
    where: {
      title: { contains: true },
      NOT: {
        status: { equals: 'archived' },
      },
    },
  })
  .findMany({
    where: { title: { contains: 'demo' } },
  })
```

`status = 'archived'` is always excluded regardless of client input.

Combinators can be nested and mixed with scalar fields freely. The same field can appear both at the top level and inside a combinator.

If the same field and operator appear as forced values in different parts of the shape (e.g. top-level and inside an `AND` combinator), the forced values are conflict-checked. Identical values are deduplicated. Different values throw `ShapeError` — this prevents ambiguous security configurations from silently degrading.

---

## Relation filters in where shapes

Where shapes support relation-level filters using Prisma's relation operators. To-many relations support `some`, `every`, and `none`. To-one relations support `is` and `isNot`.
```ts
await prisma.user
  .guard({
    where: {
      posts: {
        some: {
          title: { contains: true },
          published: { equals: true },
        },
      },
    },
  })
  .findMany({
    where: {
      posts: {
        some: {
          title: { contains: 'guide' },
          published: { equals: true },
        },
      },
    },
  })
```

Each relation operator value is a nested where config for the related model. All where features — scalar operators, forced values, logical combinators, and nested relation filters — work recursively inside relation filters.

### Forced values in relation filters
```ts
await prisma.user
  .guard({
    where: {
      posts: {
        some: {
          title: { contains: true },
          status: { equals: 'published' },
        },
      },
    },
  })
  .findMany({
    where: {
      posts: {
        some: { title: { contains: 'guide' } },
      },
    },
  })
```

`status = 'published'` is always enforced inside the `some` operator.

### To-one relations
```ts
await prisma.post
  .guard({
    where: {
      author: {
        is: {
          role: { equals: true },
        },
      },
    },
  })
  .findMany({
    where: {
      author: {
        is: { role: { equals: 'ADMIN' } },
      },
    },
  })
```

### Combined with logical combinators
```ts
await prisma.user
  .guard({
    where: {
      OR: {
        posts: {
          some: { published: { equals: true } },
        },
        profile: {
          is: { bio: { contains: true } },
        },
      },
    },
  })
  .findMany({
    where: {
      OR: [
        { posts: { some: { published: { equals: true } } } },
        { profile: { is: { bio: { contains: 'engineer' } } } },
      ],
    },
  })
```

Using an unsupported operator for the relation type throws `ShapeError`. For example, `some` on a to-one relation or `is` on a to-many relation is rejected.

### Non-empty relation filter enforcement

When all conditions inside a relation operator are client-controlled (no forced values), the client must provide at least one condition. Empty nested where objects are rejected:
```ts
// Shape allows filtering posts by title
where: {
  posts: {
    some: {
      title: { contains: true },
    },
  },
}

// This is rejected — at least one condition required
{ where: { posts: { some: {} } } }

// This is accepted
{ where: { posts: { some: { title: { contains: 'demo' } } } } }
```

When a relation operator contains forced values, the client may omit all client-controlled conditions. The forced values are still injected:
```ts
// Shape forces status filter, client controls title
where: {
  posts: {
    some: {
      status: { equals: 'published' },
      title: { contains: true },
    },
  },
}

// Accepted — forced status is still applied
{ where: { posts: { some: {} } } }
// Becomes: { posts: { some: { status: { equals: 'published' } } } }
```

Similarly, if all operators on a relation are forced or no operators have client-controlled conditions, the relation operator container itself may be empty or absent.

---

## Mutation return projection

Mutations that return records can use `select` and `include` in the guard shape to control which fields and relations are returned. This uses the same shape syntax as reads — the shape whitelists what the client may request, and forced where conditions on nested includes work identically.

### Which methods support projection

| Method                | Returns           | select/include |
| --------------------- | ----------------- | -------------- |
| `create`              | record            | yes            |
| `createMany`          | BatchPayload      | no             |
| `createManyAndReturn` | record[]          | yes            |
| `update`              | record            | yes            |
| `updateMany`          | BatchPayload      | no             |
| `updateManyAndReturn` | record[]          | yes            |
| `delete`              | record            | yes            |
| `deleteMany`          | BatchPayload      | no             |

### Create with projection
```ts
await prisma.project
  .guard({
    data: { title: true },
    include: {
      members: true,
    },
  })
  .create({
    data: { title: 'New project' },
    include: { members: true },
  })
```

### Update with select
```ts
await prisma.project
  .guard({
    data: { title: true },
    where: { id: { equals: true } },
    select: {
      id: true,
      title: true,
      members: {
        select: { id: true, email: true },
      },
    },
  })
  .update({
    data: { title: 'Updated' },
    where: { id: { equals: 'abc123' } },
    select: {
      id: true,
      title: true,
      members: {
        select: { id: true, email: true },
      },
    },
  })
```

### Delete with include
```ts
await prisma.project
  .guard({
    where: { id: { equals: true } },
    include: { members: true },
  })
  .delete({
    where: { id: { equals: 'abc123' } },
    include: { members: true },
  })
```

### Forced where on nested includes in mutations

Forced where conditions work the same as in reads. This is useful for ensuring tenant-scoped nested data in mutation responses:
```ts
await prisma.project
  .guard({
    data: { title: true },
    include: {
      members: {
        where: { isActive: { equals: true } },
      },
    },
  })
  .create({
    data: { title: 'New project' },
    include: { members: true },
  })
```

The returned `members` will always be filtered to `isActive = true`, regardless of what the client sends.

### Projection is optional

If the shape does not define `select` or `include`, the mutation returns the full record (default Prisma behavior). The projection shape is purely additive — omitting it changes nothing about existing behavior.

### select and include are mutually exclusive

Same as reads: a shape (and a body) cannot define both `select` and `include` at the same level. Doing so throws `ShapeError`.

### Batch methods do not support projection

`createMany`, `updateMany`, and `deleteMany` return `BatchPayload` (a count), not records. Passing `select` or `include` in the shape or body for these methods throws `ShapeError`.

---

## Named shapes and caller routing

Different pages or API consumers often need different shapes for the same model. Named shapes route requests to the right shape based on a caller value.

Caller is provided as the second argument to `.guard()` or via the context function — never in the request body. This keeps the method body clean and Prisma-compatible.

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
  }, req.headers['x-caller'])
  .findMany(req.body)
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

The backend passes `caller` as the second argument to `.guard()`. The request body contains only Prisma-compatible fields.

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
  }, req.headers['x-caller'])
  .update({
    data: req.body.data,
    where: { id: { equals: req.params.id } },
  })
```

### Named shapes with inline refines
```ts
await prisma.project
  .guard({
    '/admin/projects': {
      data: {
        title: (base) => base.min(1).max(500),
        status: true,
      },
    },
    '/public/projects': {
      data: {
        title: (base) => base.min(1).max(100),
      },
    },
  }, req.headers['x-caller'])
  .create({ data: req.body })
```

All data shape value types (`true`, literal, function) work in named shapes, context-dependent shapes, and single shapes.

### Caller resolution order

Caller is resolved in priority order:

1. **Explicit argument** — `.guard(shapes, '/admin/projects')` always wins
2. **Context function** — if the context object has a `caller` string property, it is used as the default
3. **None** — if neither source provides a caller and the shape is a named map, `CallerError` is thrown

This enables three usage patterns:
```ts
// 1. Per-request via context (set once, used everywhere)
guard.extension(() => ({
  Tenant: store.getStore()?.tenantId,
  caller: store.getStore()?.caller,
}))
await prisma.project.guard(shapes).findMany(req.body)

// 2. Explicit override per call
await prisma.project.guard(shapes, '/admin/projects').findMany(req.body)

// 3. Single shape (no caller needed)
await prisma.project.guard({ where: { ... } }).findMany(req.body)
```

The `caller` key in the context object is not used for scope injection — it is only used for shape routing. Scope roots are identified by matching context keys against `@scope-root` model names.

### Parameterized caller patterns
```text
/org/:orgId/users
/org/:orgId/users/:userId
```

Matching is case-sensitive. Exact matches are checked first. If no exact match is found, parameterized patterns are evaluated. Parameters are routing-only and are not extracted into context.

### Fail-closed behavior

If `caller` is missing or doesn't match any pattern, the request is rejected with a `CallerError`. If a caller matches multiple parameterized patterns, it is also rejected with a `CallerError`.

If a request body contains a `caller` field when using named shapes, it is rejected with a `CallerError` that directs the developer to use the second argument to `.guard()` or the context function instead.

---

## Context-dependent shapes

Shapes can be functions that receive the context provided to `guard.extension()`. This is the same context used for tenant scoping and caller routing — no separate mechanism.
```ts
const prisma = new PrismaClient().$extends(
  guard.extension(() => ({
    Tenant: store.getStore()?.tenantId,
    role: store.getStore()?.role,
    caller: store.getStore()?.caller,
  }))
)
```

The context function returns an object with arbitrary keys. Keys whose values are `string`, `number`, or `bigint` and that match a scope root model name are used as scope context for tenant isolation. The `caller` key (if a string) is used as the default caller for named shape routing. Other keys (like `role` in the example above) are passed through to shape functions but are not used for scoping or routing.

The context function must return a plain object. If it returns `null`, `undefined`, an array, a primitive, or any non-plain-object value, a `PolicyError` is thrown. This is enforced consistently across all code paths that consume context — scope injection, caller resolution, and dynamic shape evaluation.

Dynamic shape functions must return a plain guard shape object. If the function throws or returns a non-object value, a `ShapeError` is raised.

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

### Context-dependent data shapes with inline refines
```ts
await prisma.project
  .guard((ctx) => ({
    data: {
      title: (base) => base.min(1).max(ctx.role === 'admin' ? 500 : 200),
      status: ctx.role === 'admin' ? true : 'draft',
    },
  }))
  .create({ data: req.body })
```

Context-dependent shapes can use the context both for structural decisions (which fields to expose, forced vs client-provided) and within inline refine functions (dynamic validation limits).

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
  .findMany(req.body)
```

Static shapes and function shapes can be mixed freely in the same shape map. In this example, the caller is resolved from `contextFn().caller` since no explicit caller is passed.

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

* Nested reads loaded via `include` or `select` — use forced where conditions in the shape to restrict these (to-many relations only; see [Limitations](#limitations))
* Nested writes — Prisma extension hooks operate on top-level operations only. Guarded data shapes reject relation fields entirely, so nested writes are only possible through raw (unguarded) Prisma calls.
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

## Multi-root scope behavior

A model can be scoped by multiple scope roots simultaneously. If `Project` has a foreign key to both `Tenant` and `Organization` (both marked `@scope-root`), the scope extension enforces both.

On reads, both scope conditions are combined with `AND`. If `onMissingScopeContext` is `"warn"` or `"ignore"`, only present roots are enforced — missing roots are skipped. If `"error"` (the default), all roots must be present.

On writes, all scope roots must be present in the context. A missing root always throws `PolicyError`, regardless of `onMissingScopeContext`.

Scope foreign keys for all present roots are injected into create data and stripped from update/delete data.

If this behavior is not what you want, restructure your schema so the model references only one scope root, or handle scoping explicitly via shape rules.

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

Guard shapes for `findUnique` and `findUniqueOrThrow` must define `where`. A shape without `where` for these methods throws `ShapeError`.

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

Guarded data shapes reject relation fields entirely — using a relation field in a `data` shape throws `ShapeError`. This means nested writes (e.g. `{ author: { connect: { id: '...' } } }`) are only possible through raw (unguarded) Prisma calls. The guard layer prevents them in guarded mutations, not by intercepting nested writes, but by refusing to include relation fields in the data shape.

### Nested reads via include are not scope-filtered

The scope extension operates on the top-level operation only. If a query uses `include` or `select` to load a relation that is itself a scoped model, the nested results are not tenant-filtered by the extension. Use forced where conditions in the include/select shape to restrict nested reads. This applies to both read operations and mutation return projections.

### Forced where on nested reads is limited to to-many relations

Prisma does not support `where` on to-one relation includes. Because of this, forced `where` conditions in nested include/select shapes only work on to-many relations.

For to-one relations (e.g. `author` on a `Post`), the available mitigations are: omit the relation from the include/select shape entirely, restrict which scalar fields are returned using nested `select`, or rely on database-level constraints (e.g. RLS, foreign key guarantees).

This is a Prisma API constraint, not a prisma-guard limitation.

### `findUnique` cannot be safely scoped in Prisma extension mode

This is a Prisma API limitation, not a conceptual limitation of scoped unique lookups.

That is why `findUniqueMode = "reject"` is recommended.

Guard shapes for `findUnique` and `findUniqueOrThrow` must define `where`. A shape without `where` throws `ShapeError`.

### Composite foreign keys to scope roots

If a model references a scope root through composite foreign keys, that specific root is excluded from the model's scope entries when `onAmbiguousScope` is `"warn"` or `"ignore"`, and causes a generation error when `onAmbiguousScope` is `"error"` (the default). Other non-ambiguous roots on the same model are still auto-scoped.

Handle these models explicitly via shape rules.

### Cursor fields must cover a unique constraint

Prisma requires cursor-based pagination to use uniquely-identifiable fields. Guard enforces this at shape construction time: cursor fields must cover at least one unique constraint from the model. Non-unique cursor shapes are rejected with `ShapeError`.

### `@zod` on list fields applies to the array

`@zod` directives on list fields (e.g. `String[]`) apply to the `z.array(...)` schema, not to individual elements. For example, `.min(1)` on a `String[]` field enforces a minimum array length of 1, not a minimum string length per element.

### Batch methods do not support return projection

`createMany`, `updateMany`, and `deleteMany` return `BatchPayload` (a count). Passing `select` or `include` in the shape or body for these methods throws `ShapeError`.

### Generated output is TypeScript with ESM imports

The generator writes `index.ts` and `client.ts` using `.js` extension imports. A TypeScript-capable build pipeline with ESM-aware module resolution is required (`"moduleResolution": "NodeNext"` or `"Bundler"` in `tsconfig.json`). The classic `"moduleResolution": "node"` setting is not compatible.

### `having` is limited to scalar fields

Guard `having` shapes support scalar field filters with their type-appropriate operators. Aggregate-level having expressions (e.g. `_count`, `_avg` inside having) are not supported.

### Json fields accept any JSON-serializable value

`Json` fields are recursively validated as JSON-serializable values (string, number, boolean, null, plain objects, arrays). Values that are not JSON-serializable — including `undefined`, functions, symbols, class instances (such as `Date`), `NaN`, `Infinity`, and circular references — are rejected. This does not enforce any particular JSON structure. If you need structured JSON validation, use a context-dependent shape or validate before calling guard.

### `refine` and inline refine functions replace `@zod` chains

When a `refine` callback is provided for a field in `guard.input()`, or when a function is used instead of `true` in a `data` shape, the callback receives the base Zod type without `@zod` chains. The `@zod` directive for that field is bypassed entirely. See [Schema annotations](#refine-replaces-zod-chains).

### `pick` and `omit` are mutually exclusive

Both `guard.input()` and `guard.model()` reject configurations that specify both `pick` and `omit`. This is enforced at both the type level and at runtime.

### `@zod` field modifiers interact with prisma-guard nullability

Using `@zod .optional()`, `.nullable()`, or `.nullish()` applies the Zod method on top of prisma-guard's own nullability/optionality handling. This can cause double-wrapping. These modifiers are available but should only be used when intentionally overriding default behavior.

### Inline refine functions are not cached

Data schemas containing inline refine functions are rebuilt on every request, since the function reference could be context-dependent (e.g. when used inside a dynamic shape that closes over context values). Static data shapes using only `true` and literal values are cached normally.

### `take` does not support negative values

Prisma supports negative `take` for reverse cursor pagination. prisma-guard restricts `take` to positive integers (minimum 1). If you need reverse pagination, construct the query server-side using a context-dependent shape.

### `skip` in shape config is a permission flag

`skip: true` in a shape config means the client is allowed to provide a `skip` value. The actual `skip` value must be a non-negative integer. This is consistent with other shape flags but differs from `take`, which uses `{ max, default? }` syntax.

### `guard.input()` defaults to allowing null for nullable fields

`guard.input()` defaults `allowNull` to `true`, matching the behavior of `.guard({ data: ... })` and Prisma's own nullable field handling. Pass `allowNull: false` to reject null values for nullable fields.

### `Decimal` fields accept JavaScript numbers

The `Decimal` base type accepts JavaScript `number`, decimal string, and Decimal-like objects. Accepting `number` is convenient but carries a precision risk: by the time the validator sees the value, floating-point precision may already be lost. For example, `0.1 + 0.2` arrives as `0.30000000000000004`. For money or high-precision values, pass decimal strings (e.g. `"0.30"`) or Prisma `Decimal` objects instead of JavaScript numbers.

### `skipDuplicates` is supported for batch create methods

`createMany` and `createManyAndReturn` accept `skipDuplicates: boolean` in the request body. This is passed through to Prisma without shape-level configuration. It is not available on `create`.

### Guarded data shapes do not permit relation fields

Relation fields in `data` shapes are rejected with `ShapeError`. Nested writes (e.g. `{ author: { connect: { id: '...' } } }`) are only possible through raw (unguarded) Prisma calls. The guard layer does not intercept or validate nested writes — it prevents them entirely in guarded mutations.

### Conflicting forced where values are rejected

If the same field and operator appear as forced values in different parts of a where shape (e.g. at the top level and inside an `AND` combinator) with different values, the shape is rejected with `ShapeError` at construction time. Identical duplicate forced values are deduplicated silently. This prevents ambiguous security configurations from silently degrading.

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

* `ZodError` — Zod validation failures on data or query args (unless `wrapZodErrors` is enabled)
* `ShapeError` — invalid shape config, unknown shape config keys, wrong method for shape, body format issues, unexpected body keys, incomplete create data shapes, invalid inline refine functions, dynamic shape functions returning invalid values, or conflicting forced where values
* `CallerError` — missing, unknown, or ambiguous caller in named shapes, or `caller` found in request body
* `PolicyError` — denied scope, missing tenant context, invalid context function return value, or rejected operations on scoped models (e.g. upsert, findUnique in reject mode)

All guard errors include `status` and `code` properties for HTTP response mapping:

| Error         | status | code             |
| ------------- | ------ | ---------------- |
| `ShapeError`  | 400    | `SHAPE_INVALID`  |
| `CallerError` | 400    | `CALLER_UNKNOWN` |
| `PolicyError` | 403    | `POLICY_DENIED`  |

### ZodError wrapping

By default, Zod validation failures throw a raw `ZodError`. This means error handling code must check for both `ZodError` and guard error types.

To unify error handling, pass `wrapZodErrors: true` in the guard config:
```ts
const guard = createGuard({
  ...generatedConfig,
  wrapZodErrors: true,
})
```

When enabled, all `ZodError` thrown during validation is caught and rethrown as `ShapeError` with `status: 400` and `code: 'SHAPE_INVALID'`. The original `ZodError` is preserved as the `cause` property. The error message includes a formatted summary of all Zod issues.

This applies to `guard.input().parse()`, `guard.query().parse()`, and all `.guard(shape).*` methods. `guard.model()` returns a raw `z.ZodObject` and is not affected.

---

## How it works internally

`prisma-guard` has two main parts.

### 1. Generator

Runs during `prisma generate`. Requires `zod` and `@prisma/client` to be installed.

It reads the Prisma DMMF and emits:

* `TYPE_MAP` — field metadata per model
* `ENUM_MAP` — enum values
* `SCOPE_MAP` — foreign key → scope root mappings
* `ZOD_CHAINS` — `@zod` directive chains (validated for syntax, method allowlist, argument arity, and basic type compatibility (method existence and type advancement for wrapper-changing methods like .nullable(), .optional(), .default()). Argument type mismatches for non-type-changing methods (e.g. .min('x') on a number field) are not caught at generation time and will fail at runtime when the schema is built.)
* `ZOD_DEFAULTS` — per-model list of fields that have `@zod .default(...)`, used by the create completeness check
* `GUARD_CONFIG` — generator config values
* `UNIQUE_MAP` — unique constraint metadata per model
* `client.ts` — pre-wired guard instance with typed model extensions

### 2. Runtime

At runtime, `guard.extension()` creates a Prisma extension that provides:

* `.guard(shape, caller?)` on every model delegate — validates input, enforces query shapes, returns typed Prisma methods
* `$allOperations` query hook — injects tenant scope into every top-level database operation

The `.guard()` call validates against the shape, merges forced values, and delegates to the underlying Prisma method. The scope layer runs transparently underneath.

Caller routing is resolved before method execution: the explicit `caller` argument takes priority, then `contextFn().caller`, then absent (which is fine for single shapes but throws `CallerError` for named shape maps).

The context function is validated on every code path that consumes it — scope injection, caller resolution, and dynamic shape evaluation all enforce the plain-object contract and throw `PolicyError` for invalid returns.

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

**`guard.query()` caching:** Static shapes passed to `guard.query()` are cached for the lifetime of the returned `QuerySchema` object. In a named shape map, each static entry is cached independently — a map with 9 static entries and 1 context-dependent entry will cache the 9 static entries. Context-dependent shapes (functions) resolve the function on each call because they depend on runtime context and are never cached.

**`.guard()` caching:** The `.guard(shape).method(body)` chain creates per-invocation caches. In typical usage, the cache is created, used for one method call, and discarded. If you store the result of `.guard(shape)` and call multiple methods on it, the cache is shared across those calls. For hot paths where the same static shape is used repeatedly, prefer `guard.query()` for persistent caching.

Data schemas containing inline refine functions are also not cached, since the function could close over runtime context values. Data shapes using only `true` and literal values are cached normally within their invocation scope. Projection schemas (select/include on mutations) are cached independently for static shapes within their invocation scope.

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
| `caller` in request body               | error always                                          |
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
| empty relation filter (no forced)      | error always                                          |
| empty relation operator container      | error always                                          |
| `pick` and `omit` both specified       | error always                                          |
| scope relation in mutation data        | controlled by `onScopeRelationWrite` (default: error) |
| incomplete create data shape           | error always                                          |
| invalid inline refine function         | error always (ShapeError)                             |
| projection on batch method             | error always                                          |
| body projection without shape          | error always                                          |
| dynamic shape returns non-object       | error always (ShapeError)                             |
| refine callback returns non-Zod schema | error always (ShapeError)                             |
| `findUnique` shape without `where`     | error always (ShapeError)                             |
| invalid relation operator for type     | error always (ShapeError)                             |
| context function returns non-object    | error always (PolicyError)                            |
| conflicting forced where values        | error always (ShapeError)                             |
| invalid context function return        | error always (PolicyError)                            |

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
7. Method bodies stay Prisma-compatible — routing and context live in `.guard()`

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
| Mutation return projection                 | yes            | manual      |
| Inline field refine in data shapes         | yes            | n/a         |
| ZodError wrapping                          | opt-in         | n/a         |
| Logical combinators in where               | yes            | manual      |
| Relation filters in where                  | yes            | manual      |
| Empty relation filter rejection            | yes            | n/a         |
| Forced where conflict detection            | yes            | n/a         |

---

## Roadmap

Possible future improvements:

* optional nested-write enforcement helpers
* richer relation-level policies
* more query method coverage (upsert)
* adapter integrations for SQL-backed runtimes
* model-specific generated types for stronger compile-time shape validation
* structured JSON field validation via schema annotations
* optional strict Decimal mode (string-only, no JavaScript number)

---

## License

MIT