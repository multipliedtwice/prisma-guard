import { describe, it, expect } from "vitest";
import { createQueryBuilder } from "../../src/runtime/query-builder.js";
import { ShapeError, CallerError } from "../../src/shared/errors.js";
import type { TypeMap, EnumMap } from "../../src/shared/types.js";

const TYPE_MAP: TypeMap = {
  User: {
    id: { type: "String", isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    email: { type: "String", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    name: { type: "String", isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    age: { type: "Int", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    role: { type: "Role", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: true, isUpdatedAt: false, isEnum: true },
    posts: { type: "Post", isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    profile: { type: "Profile", isList: false, isRequired: false, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    data: { type: "Json", isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
  Post: {
    id: { type: "String", isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    title: { type: "String", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    published: { type: "Boolean", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: true, isUpdatedAt: false },
    authorId: { type: "String", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    author: { type: "User", isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    tags: { type: "Tag", isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Profile: {
    id: { type: "String", isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    bio: { type: "String", isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    userId: { type: "String", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    user: { type: "User", isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Tag: {
    id: { type: "String", isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    label: { type: "String", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
};

const ENUM_MAP: EnumMap = { Role: ["USER", "ADMIN"] };

function qb() { return createQueryBuilder(TYPE_MAP, ENUM_MAP); }

describe("single static shape", () => {
  it("parses valid body", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { email: { contains: true } },
      take: { max: 50, default: 20 },
    });
    const result = schema.parse({ where: { email: { contains: "test" } } });
    expect(result.where).toEqual({ email: { contains: "test" } });
    expect(result.take).toBe(20);
  });

  it("rejects unknown fields in body", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { email: { contains: true } },
    });
    expect(() => schema.parse({ where: { email: { contains: "x" } }, extra: true })).toThrow();
  });

  it("rejects unknown operators in where", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { email: { contains: true } },
    });
    expect(() => schema.parse({ where: { email: { gt: "x" } } })).toThrow();
  });

  it("applies forced where values", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { email: { contains: true }, age: { gte: 18 } },
    });
    const result = schema.parse({ where: { email: { contains: "test" } } });
    expect(result.where).toEqual({
      AND: [{ email: { contains: "test" } }, { age: { gte: 18 } }],
    });
  });

  it("adds string mode for string contains", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { email: { contains: true } },
    });
    const result = schema.parse({ where: { email: { contains: "x", mode: "insensitive" } } });
    expect(result.where).toEqual({ email: { contains: "x", mode: "insensitive" } });
  });

  it("handles skip", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { skip: true });
    const result = schema.parse({ skip: 10 });
    expect(result.skip).toBe(10);
  });

  it("rejects negative skip", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { skip: true });
    expect(() => schema.parse({ skip: -1 })).toThrow();
  });
});

describe("include shapes", () => {
  it("accepts true for simple include", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { include: { posts: true } });
    const result = schema.parse({ include: { posts: true } });
    expect(result.include).toEqual({ posts: true });
  });

  it("accepts nested include with where", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      include: { posts: { where: { title: { contains: true } } } },
    });
    const result = schema.parse({ include: { posts: { where: { title: { contains: "hello" } } } } });
    expect((result.include as any).posts.where).toEqual({ title: { contains: "hello" } });
  });

  it("throws on non-relation in include", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", { include: { email: true } as any })).toThrow("not a relation");
  });

  it("accepts select inside nested include", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      include: { posts: { select: { id: true, title: true } } },
    });
    const result = schema.parse({ include: { posts: { select: { id: true, title: true } } } });
    expect((result.include as any).posts.select).toEqual({ id: true, title: true });
  });

  it("throws on select + include in same nested include", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", {
      include: { posts: { select: { id: true }, include: { tags: true } } },
    })).toThrow('cannot define both "select" and "include"');
  });
});

describe("select shapes", () => {
  it("accepts select with scalars", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { select: { id: true, email: true } });
    const result = schema.parse({ select: { id: true, email: true } });
    expect(result.select).toEqual({ id: true, email: true });
  });

  it("accepts nested select on relation", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      select: { id: true, posts: { select: { title: true } } },
    });
    const result = schema.parse({ select: { id: true, posts: { select: { title: true } } } });
    expect((result.select as any).posts.select).toEqual({ title: true });
  });

  it("throws on nested select args for scalar field", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", {
      select: { email: { select: { something: true } } as any },
    })).toThrow("not scalar");
  });
});

describe("orderBy shapes", () => {
  it("accepts single orderBy", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { orderBy: { email: true, age: true } });
    const result = schema.parse({ orderBy: { email: "asc" } });
    expect(result.orderBy).toEqual({ email: "asc" });
  });

  it("accepts array orderBy", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { orderBy: { email: true, age: true } });
    const result = schema.parse({ orderBy: [{ email: "asc" }, { age: "desc" }] });
    expect(result.orderBy).toEqual([{ email: "asc" }, { age: "desc" }]);
  });

  it("throws on relation field in orderBy", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", { orderBy: { posts: true } as any })).toThrow("Relation field");
  });

  it("throws on Json field in orderBy", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", { orderBy: { data: true } as any })).toThrow("Json field");
  });
});

describe("take shapes", () => {
  it("applies default when not provided", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { take: { max: 100, default: 25 } });
    const result = schema.parse({});
    expect(result.take).toBe(25);
  });

  it("clamps to max", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { take: { max: 10, default: 5 } });
    expect(() => schema.parse({ take: 20 })).toThrow();
  });

  it("rejects zero", () => {
    const schema = qb().buildQuerySchema("User", "findMany", { take: { max: 10, default: 5 } });
    expect(() => schema.parse({ take: 0 })).toThrow();
  });

  it("throws when default exceeds max", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", { take: { max: 5, default: 10 } })).toThrow("take default cannot exceed max");
  });
});

describe("where validation", () => {
  it("now supports relation field in where via relation operators", () => {
    expect(() => qb().buildShapeZodSchema("User", "findMany", {
      where: { posts: { some: { title: { contains: true } } } },
    })).not.toThrow();
  });

  it("throws on invalid operator for relation field in where", () => {
    expect(() => qb().buildShapeZodSchema("User", "findMany", {
      where: { posts: { equals: true } } as any,
    })).toThrow("not supported for to-many relation");
  });

  it("throws on Json field in where", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", {
      where: { data: { equals: true } } as any,
    })).toThrow("Json field");
  });

  it("throws on unknown field in where", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", {
      where: { nonexistent: { equals: true } } as any,
    })).toThrow("Unknown field");
  });
});

describe("method validation", () => {
  it("rejects include on count", () => {
    expect(() => qb().buildQuerySchema("User", "count", { include: { posts: true } })).toThrow('not allowed for method "count"');
  });

  it("allows orderBy on count", () => {
    const schema = qb().buildQuerySchema("User", "count", { orderBy: { email: true } });
    const result = schema.parse({ orderBy: { email: "asc" } });
    expect(result.orderBy).toEqual({ email: "asc" });
  });

  it("rejects take on findUnique", () => {
    expect(() => qb().buildQuerySchema("User", "findUnique", { take: { max: 10, default: 5 } })).toThrow('not allowed for method "findUnique"');
  });

  it("rejects select + include at top level", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", {
      select: { id: true }, include: { posts: true },
    })).toThrow('cannot define both "include" and "select"');
  });
});

describe("context-dependent shapes", () => {
  it("resolves shape from function with context", () => {
    type Ctx = { tenantId: string };
    const schema = qb().buildQuerySchema<Ctx>("User", "findMany", (ctx) => ({
      where: { email: { contains: true }, id: { equals: ctx.tenantId } },
    }));
    const result = schema.parse(
      { where: { email: { contains: "test" } } },
      { ctx: { tenantId: "t1" } },
    );
    expect(result.where).toEqual({
      AND: [{ email: { contains: "test" } }, { id: { equals: "t1" } }],
    });
  });

  it("throws when context missing for function shape", () => {
    const schema = qb().buildQuerySchema("User", "findMany", () => ({
      where: { email: { contains: true } },
    }));
    expect(() => schema.parse({})).toThrow();
  });
});

describe("caller map", () => {
  it("routes to correct shape by caller via opts", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/admin": { where: { email: { contains: true } } },
      "/public": { where: { age: { gte: true } } },
    });
    const r1 = schema.parse(
      { where: { email: { contains: "x" } } },
      { caller: "/admin" },
    );
    expect(r1.where).toEqual({ email: { contains: "x" } });

    const r2 = schema.parse(
      { where: { age: { gte: 18 } } },
      { caller: "/public" },
    );
    expect(r2.where).toEqual({ age: { gte: 18 } });
  });

  it("throws CallerError for unknown caller", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/admin": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({}, { caller: "/unknown" })).toThrow(CallerError);
  });

  it("throws CallerError when caller is missing", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/admin": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({})).toThrow(CallerError);
  });

  it("throws ShapeError when body is not object", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/admin": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse("not-object")).toThrow(ShapeError);
  });

  it("throws CallerError when caller in body", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/admin": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({ caller: "/admin" })).toThrow(CallerError);
  });

  it("matches parameterized patterns", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/org/:orgId/users": { where: { email: { contains: true } } },
    });
    const result = schema.parse(
      { where: { email: { contains: "x" } } },
      { caller: "/org/123/users" },
    );
    expect(result.where).toEqual({ email: { contains: "x" } });
  });

  it("rejects when pattern segment count differs", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/org/:orgId/users": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({}, { caller: "/org/123/users/extra" })).toThrow(CallerError);
  });

  it("throws on ambiguous pattern match", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/org/:orgId/users": { where: { email: { contains: true } } },
      "/:type/:id/users": { where: { email: { contains: true } } },
    });
    expect(() => schema.parse({}, { caller: "/org/123/users" })).toThrow("matches multiple patterns");
  });

  it("prefers exact match over pattern", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/org/special/users": { where: { email: { contains: true } } },
      "/org/:orgId/users": { where: { age: { gte: true } } },
    });
    const result = schema.parse(
      { where: { email: { contains: "x" } } },
      { caller: "/org/special/users" },
    );
    expect(result.where).toEqual({ email: { contains: "x" } });
  });

  it("caller does not appear in parsed result", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/admin": { where: { email: { contains: true } } },
    });
    const result = schema.parse(
      { where: { email: { contains: "x" } } },
      { caller: "/admin" },
    );
    expect(result).not.toHaveProperty("caller");
  });

  it("caller map with context function", () => {
    type Ctx = { tenantId: string };
    const schema = qb().buildQuerySchema<Ctx>("User", "findMany", {
      "/admin": (ctx) => ({
        where: { email: { contains: true }, id: { equals: ctx.tenantId } },
      }),
    });
    const result = schema.parse(
      { where: { email: { contains: "x" } } },
      { ctx: { tenantId: "t1" }, caller: "/admin" },
    );
    expect(result.where).toEqual({
      AND: [{ email: { contains: "x" } }, { id: { equals: "t1" } }],
    });
  });
});

describe("isShapeConfig heuristic fix", () => {
  it("treats config with non-shape-config keys as caller map", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/api/users": { where: { email: { contains: true } } },
    });
    const result = schema.parse(
      { where: { email: { contains: "x" } } },
      { caller: "/api/users" },
    );
    expect(result.where).toEqual({ email: { contains: "x" } });
  });

  it("throws when caller map key collides with reserved keys", () => {
    expect(() => qb().buildQuerySchema("User", "findMany", {
      where: { where: { email: { contains: true } } },
      "/valid": { where: { email: { contains: true } } },
    } as any)).toThrow("collides with reserved shape config key");
  });

  it("treats empty object as valid shape config", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {});
    const result = schema.parse({});
    expect(result).toEqual({});
  });
});

describe("schemas property", () => {
  it("exposes compiled zod schemas for static shapes", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { email: { contains: true } },
    });
    expect(schema.schemas["_default"]).toBeDefined();
  });

  it("exposes compiled zod schemas for caller map", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/admin": { where: { email: { contains: true } } },
      "/public": { where: { age: { gte: true } } },
    });
    expect(schema.schemas["/admin"]).toBeDefined();
    expect(schema.schemas["/public"]).toBeDefined();
  });

  it("does not expose schemas for function shapes", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      "/admin": () => ({ where: { email: { contains: true } } }),
    });
    expect(schema.schemas["/admin"]).toBeUndefined();
  });
});