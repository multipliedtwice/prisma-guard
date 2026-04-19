import { describe, it, expect } from "vitest";
import { createQueryBuilder } from "../../src/runtime/query-builder.js";
import { ShapeError, CallerError } from "../../src/shared/errors.js";
import type { TypeMap, EnumMap } from "../../src/shared/types.js";
import { createScalarBase } from "../../src/shared/scalar-base.js";

const TYPE_MAP: TypeMap = {
  User: {
    id: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: true,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
    },
    email: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    name: {
      type: "String",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    age: {
      type: "Int",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    score: {
      type: "Float",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    role: {
      type: "Role",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
      isEnum: true,
    },
    metadata: {
      type: "Json",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    companyId: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    company: {
      type: "Company",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: true,
      hasDefault: false,
      isUpdatedAt: false,
    },
    posts: {
      type: "Post",
      isList: true,
      isRequired: true,
      isId: false,
      isRelation: true,
      hasDefault: false,
      isUpdatedAt: false,
    },
  },
  Company: {
    id: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: true,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
    },
    name: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    users: {
      type: "User",
      isList: true,
      isRequired: true,
      isId: false,
      isRelation: true,
      hasDefault: false,
      isUpdatedAt: false,
    },
  },
  Post: {
    id: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: true,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
    },
    title: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    content: {
      type: "String",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    userId: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    author: {
      type: "User",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: true,
      hasDefault: false,
      isUpdatedAt: false,
    },
  },
};

const ENUM_MAP: EnumMap = { Role: ["ADMIN", "USER", "GUEST"] };

const scalarBase = createScalarBase(false);

function makeQb() {
  return createQueryBuilder(TYPE_MAP, ENUM_MAP, {}, scalarBase);
}

describe("query-builder coverage: aggregate operations", () => {
  const qb = makeQb();

  it("builds _count with specific fields", () => {
    const schema = qb.buildQuerySchema("User", "aggregate", {
      _count: { email: true, name: true },
    });
    const result = schema.parse({ _count: { email: true } });
    expect(result._count).toEqual({ email: true });
  });

  it("builds _count as true", () => {
    const schema = qb.buildQuerySchema("User", "aggregate", { _count: true });
    const result = schema.parse({ _count: true });
    expect(result._count).toBe(true);
  });

  it("throws on unknown field in _count", () => {
    expect(() =>
      qb.buildQuerySchema("User", "aggregate", {
        _count: { nonexistent: true },
      }),
    ).toThrow(ShapeError);
  });

  it("builds _avg with valid numeric fields", () => {
    const schema = qb.buildQuerySchema("User", "aggregate", {
      _avg: { age: true, score: true },
    });
    const result = schema.parse({ _avg: { age: true } });
    expect(result._avg).toEqual({ age: true });
  });

  it("throws on unknown field in _avg", () => {
    expect(() =>
      qb.buildQuerySchema("User", "aggregate", { _avg: { nonexistent: true } }),
    ).toThrow(ShapeError);
  });

  it("throws on relation field in _avg", () => {
    expect(() =>
      qb.buildQuerySchema("User", "aggregate", { _avg: { company: true } }),
    ).toThrow(ShapeError);
  });

  it("builds _sum, _min, _max with valid fields", () => {
    const schema = qb.buildQuerySchema("User", "aggregate", {
      _sum: { age: true },
      _min: { age: true, score: true },
      _max: { score: true },
    });
    const result = schema.parse({
      _sum: { age: true },
      _min: { age: true },
      _max: { score: true },
    });
    expect(result._sum).toEqual({ age: true });
    expect(result._min).toEqual({ age: true });
    expect(result._max).toEqual({ score: true });
  });

  it("throws on unknown field in _sum", () => {
    expect(() =>
      qb.buildQuerySchema("User", "aggregate", { _sum: { nonexistent: true } }),
    ).toThrow(ShapeError);
  });

  it("throws on relation field in _min", () => {
    expect(() =>
      qb.buildQuerySchema("User", "aggregate", { _min: { posts: true } }),
    ).toThrow(ShapeError);
  });
});

describe("query-builder coverage: groupBy", () => {
  const qb = makeQb();

  it("builds groupBy with by and _count", () => {
    const schema = qb.buildQuerySchema("User", "groupBy", {
      by: ["role"],
      _count: true,
    });
    const result = schema.parse({ by: ["role"], _count: true });
    expect(result.by).toEqual(["role"]);
  });

  it("throws on groupBy without by", () => {
    expect(() =>
      qb.buildQuerySchema("User", "groupBy", { _count: true } as any),
    ).toThrow(ShapeError);
  });

  it("throws on unknown field in by", () => {
    expect(() =>
      qb.buildQuerySchema("User", "groupBy", { by: ["nonexistent"] }),
    ).toThrow(ShapeError);
  });

  it("throws on relation field in by", () => {
    expect(() =>
      qb.buildQuerySchema("User", "groupBy", { by: ["company"] }),
    ).toThrow(ShapeError);
  });

  it("throws on groupBy with include", () => {
    expect(() =>
      qb.buildQuerySchema("User", "groupBy", {
        by: ["role"],
        include: { posts: true },
      } as any),
    ).toThrow(ShapeError);
  });

  it("throws on groupBy with select", () => {
    expect(() =>
      qb.buildQuerySchema("User", "groupBy", {
        by: ["role"],
        select: { id: true },
      } as any),
    ).toThrow(ShapeError);
  });
});

describe("query-builder coverage: aggregate method validation", () => {
  const qb = makeQb();

  it("throws on aggregate with include", () => {
    expect(() =>
      qb.buildQuerySchema("User", "aggregate", {
        include: { posts: true },
      } as any),
    ).toThrow(ShapeError);
  });

  it("throws on aggregate with select", () => {
    expect(() =>
      qb.buildQuerySchema("User", "aggregate", { select: { id: true } } as any),
    ).toThrow(ShapeError);
  });
});

describe("query-builder coverage: forced tree merge on include", () => {
  const qb = makeQb();

  it("merges forced WHERE into nested include when client sends object", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      include: {
        posts: {
          where: {
            title: { contains: true },
            userId: { equals: "forced-user" },
          },
        },
      },
    });
    const result = schema.parse({
      include: { posts: { where: { title: { contains: "test" } } } },
    });
    const postsWhere = (result.include as any).posts.where;
    expect(postsWhere).toEqual({
      AND: [
        { title: { contains: "test" } },
        { userId: { equals: "forced-user" } },
      ],
    });
  });

  it("expands true to forced values when client sends true for relation with forced where", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      include: { posts: { where: { userId: { equals: "forced-user" } } } },
    });
    const result = schema.parse({ include: { posts: true } });
    const posts = (result.include as any).posts;
    expect(posts).toEqual({ where: { userId: { equals: "forced-user" } } });
  });

  it("preserves forced values when client does not include the relation", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      include: { posts: { where: { userId: { equals: "forced-user" } } } },
    });
    const result = schema.parse({});
    expect((result as any).include).toBeUndefined();
  });
});

describe("query-builder coverage: forced tree merge on select", () => {
  const qb = makeQb();

  it("merges forced WHERE into nested select relation", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      select: {
        id: true,
        posts: {
          where: {
            title: { contains: true },
            userId: { equals: "forced-user" },
          },
          select: { title: true },
        },
      },
    });
    const result = schema.parse({
      select: {
        id: true,
        posts: {
          where: { title: { contains: "hello" } },
          select: { title: true },
        },
      },
    });
    const postsWhere = (result.select as any).posts.where;
    expect(postsWhere).toEqual({
      AND: [
        { title: { contains: "hello" } },
        { userId: { equals: "forced-user" } },
      ],
    });
  });

  it("expands true to forced values in select mode", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      select: {
        id: true,
        posts: {
          where: { userId: { equals: "forced-user" } },
          select: { title: true },
        },
      },
    });
    const result = schema.parse({ select: { id: true, posts: true } });
    const posts = (result.select as any).posts;
    expect(posts).toEqual({ where: { userId: { equals: "forced-user" } } });
  });
});

describe("query-builder coverage: nested include args", () => {
  const qb = makeQb();

  it("builds nested include with orderBy, cursor, take, skip", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      include: {
        posts: {
          orderBy: { title: true },
          cursor: { id: true },
          take: { max: 50, default: 10 },
          skip: true,
        },
      },
    });
    const result = schema.parse({
      include: {
        posts: {
          orderBy: { title: "asc" },
          cursor: { id: "cursor-id" },
          take: 20,
          skip: 5,
        },
      },
    });
    const posts = (result.include as any).posts;
    expect(posts.orderBy).toEqual({ title: "asc" });
    expect(posts.cursor).toEqual({ id: "cursor-id" });
    expect(posts.take).toBe(20);
    expect(posts.skip).toBe(5);
  });

  it("builds nested include with nested select", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      include: { posts: { select: { id: true, title: true } } },
    });
    const result = schema.parse({
      include: { posts: { select: { id: true, title: true } } },
    });
    expect((result.include as any).posts.select).toEqual({
      id: true,
      title: true,
    });
  });

  it("throws on nested include with both select and include", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        include: {
          posts: { select: { id: true }, include: { author: true } } as any,
        },
      }),
    ).toThrow(ShapeError);
  });

  it("builds _count in include as true", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      include: { _count: true },
    });
    const result = schema.parse({ include: { _count: true } });
    expect((result.include as any)._count).toBe(true);
  });

  it("builds _count in include with select", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      include: { _count: { select: { posts: true } } },
    });
    const result = schema.parse({
      include: { _count: { select: { posts: true } } },
    });
    expect((result.include as any)._count).toEqual({ select: { posts: true } });
  });

  it("throws on _count in include with unknown relation", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        include: { _count: { select: { nonexistent: true } } },
      }),
    ).toThrow(ShapeError);
  });

  it("throws on _count in include with non-relation field", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        include: { _count: { select: { email: true } } },
      }),
    ).toThrow(ShapeError);
  });

  it("throws on _count in include with invalid shape", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        include: { _count: { notSelect: { posts: true } } } as any,
      }),
    ).toThrow(ShapeError);
  });

  it("throws on _count in include with empty select", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        include: { _count: { select: {} } },
      }),
    ).toThrow(ShapeError);
  });
});

describe("query-builder coverage: nested select args", () => {
  const qb = makeQb();

  it("builds nested select with orderBy, cursor, take, skip", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      select: {
        id: true,
        posts: {
          select: { id: true, title: true },
          orderBy: { title: true },
          cursor: { id: true },
          take: { max: 50, default: 10 },
          skip: true,
        },
      },
    });
    const result = schema.parse({
      select: {
        id: true,
        posts: {
          select: { id: true },
          orderBy: { title: "desc" },
          cursor: { id: "c1" },
          take: 5,
          skip: 2,
        },
      },
    });
    const posts = (result.select as any).posts;
    expect(posts.orderBy).toEqual({ title: "desc" });
    expect(posts.cursor).toEqual({ id: "c1" });
    expect(posts.take).toBe(5);
    expect(posts.skip).toBe(2);
  });

  it("throws on nested select args for scalar field", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        select: { email: { select: { something: true } } as any },
      }),
    ).toThrow(ShapeError);
  });
});

describe("query-builder coverage: caller matching", () => {
  const qb = makeQb();

  it("throws CallerError for unknown caller", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      "/admin/users": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({}, { caller: "/unknown/path" })).toThrow(
      CallerError,
    );
  });

  it("throws CallerError for missing caller", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      "/admin/users": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({ where: {} })).toThrow(CallerError);
  });

  it("throws ShapeError when body is not an object (caller mode)", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      "/admin/users": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse("string-body")).toThrow(ShapeError);
  });

  it("throws CallerError when caller matches multiple patterns", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      "/org/:orgId/users": { where: { email: { contains: true } } },
      "/org/:orgId/:action": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({}, { caller: "/org/123/users" })).toThrow(
      CallerError,
    );
  });

  it("matches pattern callers with :param segments", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      "/org/:orgId/users": { where: { email: { contains: true } } },
    });
    const result = schema.parse(
      { where: { email: { contains: "test" } } },
      { caller: "/org/abc-123/users" },
    );
    expect(result.where).toEqual({ email: { contains: "test" } });
  });

  it("does not match pattern when segment count differs", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      "/org/:orgId/users": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({}, { caller: "/org/123/users/extra" })).toThrow(
      CallerError,
    );
  });

  it("throws ShapeError for reserved caller key collision", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        where: { where: { email: { contains: true } } },
      } as any),
    ).toThrow(ShapeError);
  });
});

describe("query-builder coverage: caller with context function", () => {
  const qb = makeQb();

  it("throws when context missing for caller shape function", () => {
    const schema = qb.buildQuerySchema<{ companyId: string }>(
      "User",
      "findMany",
      {
        "/admin": (ctx) => ({
          where: { companyId: { equals: ctx.companyId } },
        }),
      },
    );
    expect(() => schema.parse({}, { caller: "/admin" })).toThrow();
  });

  it("resolves caller shape function with context", () => {
    const schema = qb.buildQuerySchema<{ companyId: string }>(
      "User",
      "findMany",
      {
        "/admin": (ctx) => ({
          where: { companyId: { equals: ctx.companyId } },
        }),
      },
    );
    const result = schema.parse(
      {},
      { ctx: { companyId: "c1" }, caller: "/admin" },
    );
    expect(result.where).toEqual({ companyId: { equals: "c1" } });
  });
});

describe("query-builder coverage: method arg validation", () => {
  const qb = makeQb();

  it("throws on disallowed arg for method", () => {
    expect(() =>
      qb.buildQuerySchema("User", "count", { include: { posts: true } } as any),
    ).toThrow(ShapeError);
  });

  it("throws on both include and select in body, not in shape", () => {
    const schema = qb.buildQuerySchema("User", "findMany", {
      include: { posts: true },
      select: { id: true },
    });
    expect(() =>
      schema.parse({ include: { posts: true }, select: { id: true } }),
    ).toThrow(ShapeError);
  });

  it("throws on take default exceeding max", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        take: { max: 10, default: 20 },
      }),
    ).toThrow(ShapeError);
  });
});

describe("query-builder coverage: cursor and orderBy errors", () => {
  const qb = makeQb();

  it("throws on unknown field in cursor", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        cursor: { nonexistent: true },
      }),
    ).toThrow(ShapeError);
  });

  it("throws on relation field in cursor", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", { cursor: { company: true } }),
    ).toThrow(ShapeError);
  });

  it("throws on relation field in orderBy", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", { orderBy: { company: true } }),
    ).toThrow(ShapeError);
  });

  it("throws on Json field in orderBy", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", { orderBy: { metadata: true } }),
    ).toThrow(ShapeError);
  });
});

describe("query-builder coverage: where errors", () => {
  const qb = makeQb();

  it("throws on Json field in where", () => {
    expect(() =>
      qb.buildQuerySchema("User", "findMany", {
        where: { metadata: { equals: true } },
      }),
    ).toThrow(ShapeError);
  });

  it("throws on unknown model", () => {
    expect(() =>
      qb.buildQuerySchema("NonExistent", "findMany", {
        where: { id: { equals: true } },
      }),
    ).toThrow(ShapeError);
  });
});
