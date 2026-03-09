import { describe, it, expect } from "vitest";
import { createQueryBuilder } from "../../src/runtime/query-builder.js";
import { ShapeError } from "../../src/shared/errors.js";
import type { TypeMap, EnumMap } from "../../src/shared/types.js";

const typeMap: TypeMap = {
  User: {
    id: {
      type: "Int",
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
    email: {
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
    tags: {
      type: "String",
      isList: true,
      isRequired: true,
      isId: false,
      isRelation: false,
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
    profile: {
      type: "Profile",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: true,
      hasDefault: false,
      isUpdatedAt: false,
    },
  },
  Post: {
    id: {
      type: "Int",
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
    published: {
      type: "Boolean",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    userId: {
      type: "Int",
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
  Profile: {
    id: {
      type: "Int",
      isList: false,
      isRequired: true,
      isId: true,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
    },
    bio: {
      type: "String",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    userId: {
      type: "Int",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
  },
};

const enumMap: EnumMap = { Role: ["ADMIN", "USER"] };

function qb() {
  return createQueryBuilder(typeMap, enumMap);
}

describe("where: relation filters", () => {
  it("to-many some with client and forced values", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        posts: {
          some: {
            title: { contains: true },
            userId: { equals: 99 },
          },
        },
      },
    });
    const result = schema.parse({
      where: { posts: { some: { title: { contains: "hello" } } } },
    });
    const someWhere = (result.where as any).posts.some;
    expect(someWhere).toEqual({
      AND: [{ title: { contains: "hello" } }, { userId: { equals: 99 } }],
    });
  });

  it("to-many every operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        posts: {
          every: { published: { equals: true } },
        },
      },
    });
    const result = schema.parse({
      where: { posts: { every: { published: { equals: true } } } },
    });
    expect((result.where as any).posts.every).toEqual({
      published: { equals: true },
    });
  });

  it("to-many none operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        posts: {
          none: { published: { equals: true } },
        },
      },
    });
    const result = schema.parse({
      where: { posts: { none: { published: { equals: true } } } },
    });
    expect((result.where as any).posts.none).toEqual({
      published: { equals: true },
    });
  });

  it("to-one is operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        profile: {
          is: { bio: { contains: true } },
        },
      },
    });
    const result = schema.parse({
      where: { profile: { is: { bio: { contains: "eng" } } } },
    });
    expect((result.where as any).profile.is).toEqual({
      bio: { contains: "eng" },
    });
  });

  it("to-one isNot operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        profile: {
          isNot: { bio: { contains: true } },
        },
      },
    });
    const result = schema.parse({
      where: { profile: { isNot: { bio: { contains: "spam" } } } },
    });
    expect((result.where as any).profile.isNot).toEqual({
      bio: { contains: "spam" },
    });
  });

  it("rejects to-one operators on to-many relation", () => {
    expect(() =>
      qb().buildQuerySchema("User", "findMany", {
        where: { posts: { is: { title: { contains: true } } } as any },
      }),
    ).toThrow(ShapeError);
  });

  it("rejects to-many operators on to-one relation", () => {
    expect(() =>
      qb().buildQuerySchema("User", "findMany", {
        where: { profile: { some: { bio: { contains: true } } } as any },
      }),
    ).toThrow(ShapeError);
  });

  it("rejects non-object relation filter", () => {
    expect(() =>
      qb().buildQuerySchema("User", "findMany", {
        where: { posts: "invalid" as any },
      }),
    ).toThrow(ShapeError);
  });

  it("rejects non-object nested filter value", () => {
    expect(() =>
      qb().buildQuerySchema("User", "findMany", {
        where: { posts: { some: "invalid" as any } },
      }),
    ).toThrow(ShapeError);
  });

  it("rejects empty relation filter when no forced values", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { posts: { some: { title: { contains: true } } } },
    });
    expect(() =>
      schema.parse({
        where: { posts: { some: {} } },
      }),
    ).toThrow();
  });

  it("forced relation where allows empty client input", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        posts: {
          some: { userId: { equals: 99 } },
        },
      },
    });
    const result = schema.parse({});
    expect(result.where).toEqual({
      posts: { some: { userId: { equals: 99 } } },
    });
  });
});

describe("where: combinators", () => {
  it("AND combinator with client values", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        AND: {
          name: { contains: true },
          age: { gte: true },
        },
      },
    });
    const result = schema.parse({
      where: {
        AND: [{ name: { contains: "test" } }, { age: { gte: 18 } }],
      },
    });
    expect(result.where).toEqual({
      AND: [{ name: { contains: "test" } }, { age: { gte: 18 } }],
    });
  });

  it("OR combinator with client values", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        OR: {
          name: { contains: true },
          age: { gte: true },
        },
      },
    });
    const result = schema.parse({
      where: {
        OR: [{ name: { contains: "test" } }],
      },
    });
    expect(result.where).toEqual({
      OR: [{ name: { contains: "test" } }],
    });
  });

  it("NOT combinator as object", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        NOT: { name: { equals: true } },
      },
    });
    const result = schema.parse({
      where: { NOT: { name: { equals: "blocked" } } },
    });
    expect(result.where).toEqual({ NOT: { name: { equals: "blocked" } } });
  });

  it("NOT combinator as array", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        NOT: { name: { equals: true } },
      },
    });
    const result = schema.parse({
      where: { NOT: [{ name: { equals: "a" } }, { name: { equals: "b" } }] },
    });
    expect(result.where).toEqual({
      NOT: [{ name: { equals: "a" } }, { name: { equals: "b" } }],
    });
  });

  it("forced NOT combinator lifts to top-level NOT", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: {
        name: { contains: true },
        NOT: { age: { equals: 0 } },
      },
    });
    const result = schema.parse({
      where: { name: { contains: "test" } },
    });
    expect(result.where).toEqual({
      AND: [{ name: { contains: "test" } }, { NOT: { age: { equals: 0 } } }],
    });
  });

  it("rejects non-object combinator value", () => {
    expect(() =>
      qb().buildQuerySchema("User", "findMany", {
        where: { AND: "invalid" as any },
      }),
    ).toThrow(ShapeError);
  });

  it("rejects non-object where config for scalar", () => {
    expect(() =>
      qb().buildQuerySchema("User", "findMany", {
        where: { name: "invalid" as any },
      }),
    ).toThrow(ShapeError);
  });
});

describe("where: nullable field operators", () => {
  it("nullable field equals accepts null", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { email: { equals: true } },
    });
    const result = schema.parse({ where: { email: { equals: null } } });
    expect((result.where as any).email.equals).toBeNull();
  });

  it("nullable field in accepts null in array", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { email: { in: true } },
    });
    const result = schema.parse({
      where: { email: { in: ["a@b.com", null] } },
    });
    expect((result.where as any).email.in).toEqual(["a@b.com", null]);
  });
});

describe("where: enum operators", () => {
  it("enum equals operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { role: { equals: true } },
    });
    const result = schema.parse({ where: { role: { equals: "ADMIN" } } });
    expect((result.where as any).role.equals).toBe("ADMIN");
  });

  it("enum in operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { role: { in: true } },
    });
    const result = schema.parse({ where: { role: { in: ["ADMIN", "USER"] } } });
    expect((result.where as any).role.in).toEqual(["ADMIN", "USER"]);
  });

  it("enum not operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { role: { not: true } },
    });
    const result = schema.parse({ where: { role: { not: "ADMIN" } } });
    expect((result.where as any).role.not).toBe("ADMIN");
  });

  it("rejects unsupported enum operator", () => {
    expect(() =>
      qb().buildQuerySchema("User", "findMany", {
        where: { role: { contains: true } as any },
      }),
    ).toThrow(ShapeError);
  });
});

describe("where: scalar list operators", () => {
  it("has operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { tags: { has: true } },
    });
    const result = schema.parse({ where: { tags: { has: "typescript" } } });
    expect((result.where as any).tags.has).toBe("typescript");
  });

  it("hasSome operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { tags: { hasSome: true } },
    });
    const result = schema.parse({ where: { tags: { hasSome: ["a", "b"] } } });
    expect((result.where as any).tags.hasSome).toEqual(["a", "b"]);
  });

  it("hasEvery operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { tags: { hasEvery: true } },
    });
    const result = schema.parse({ where: { tags: { hasEvery: ["a"] } } });
    expect((result.where as any).tags.hasEvery).toEqual(["a"]);
  });

  it("isEmpty operator", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { tags: { isEmpty: true } },
    });
    const result = schema.parse({ where: { tags: { isEmpty: true } } });
    expect((result.where as any).tags.isEmpty).toBe(true);
  });

  it("equals operator on list", () => {
    const schema = qb().buildQuerySchema("User", "findMany", {
      where: { tags: { equals: true } },
    });
    const result = schema.parse({ where: { tags: { equals: ["a", "b"] } } });
    expect((result.where as any).tags.equals).toEqual(["a", "b"]);
  });
});
