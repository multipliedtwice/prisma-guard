import { describe, it, expect } from "vitest";
import { createSchemaBuilder } from "../../src/runtime/schema-builder.js";
import type { TypeMap, EnumMap, ZodChains } from "../../src/shared/types.js";
import z from "zod";
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
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    active: {
      type: "Boolean",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
    },
    role: {
      type: "Role",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
      isEnum: true,
    },
    updatedAt: {
      type: "DateTime",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: true,
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
    authorId: {
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
  Profile: {
    id: {
      type: "String",
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
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    user: {
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

const ENUM_MAP: EnumMap = {
  Role: ["USER", "ADMIN"],
};

const ZOD_CHAINS: ZodChains = {
  User: {
    email: (base: any) => base.email(),
  },
};

const scalarBase = createScalarBase(false)

function builder() {
  return createSchemaBuilder(TYPE_MAP, ZOD_CHAINS, ENUM_MAP, scalarBase, {});
}

describe("buildInputSchema", () => {
  describe("create mode", () => {
    it("requires non-default non-optional fields", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["email", "age"],
      });
      expect(() => parse({})).toThrow();
      expect(parse({ email: "a@b.com", age: 25 })).toEqual({
        email: "a@b.com",
        age: 25,
      });
    });

    it("makes optional fields optional", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["email", "age", "name"],
      });
      const result = parse({ email: "a@b.com", age: 25 });
      expect(result).toEqual({ email: "a@b.com", age: 25 });
    });

    it("makes fields with defaults optional", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["email", "age", "active"],
      });
      const result = parse({ email: "a@b.com", age: 25 });
      expect(result).toEqual({ email: "a@b.com", age: 25 });
    });

    it("excludes relation and updatedAt fields automatically", () => {
      const { parse } = builder().buildInputSchema("User", { mode: "create" });
      const result = parse({ email: "a@b.com", age: 25 });
      expect(result).not.toHaveProperty("posts");
      expect(result).not.toHaveProperty("profile");
      expect(result).not.toHaveProperty("updatedAt");
    });

    it("applies @zod chain from zodChains", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["email", "age"],
      });
      expect(() => parse({ email: "not-an-email", age: 25 })).toThrow();
    });

    it("rejects extra fields with strict", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["email", "age"],
      });
      expect(() => parse({ email: "a@b.com", age: 25, extra: true })).toThrow();
    });
  });

  describe("update mode", () => {
    it("makes all fields optional", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "update",
        pick: ["email", "age"],
      });
      expect(parse({})).toEqual({});
      expect(parse({ email: "a@b.com" })).toEqual({ email: "a@b.com" });
    });
  });

  describe("pick / omit", () => {
    it("pick limits to specified fields", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "update",
        pick: ["email"],
      });
      expect(parse({ email: "a@b.com" })).toEqual({ email: "a@b.com" });
      expect(() => parse({ email: "a@b.com", age: 25 })).toThrow();
    });

    it("omit excludes specified fields", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "update",
        omit: ["age"],
      });
      const result = parse({ email: "a@b.com" });
      expect(result).toEqual({ email: "a@b.com" });
      expect(() => parse({ age: 25 })).toThrow();
    });

    it("throws on unknown field in pick", () => {
      expect(() =>
        builder().buildInputSchema("User", {
          mode: "create",
          pick: ["nonexistent"],
        }),
      ).toThrow();
    });

    it("throws on unknown field in omit", () => {
      expect(() =>
        builder().buildInputSchema("User", {
          mode: "create",
          omit: ["nonexistent"],
        }),
      ).toThrow();
    });

    it("throws on relation field in pick", () => {
      expect(() =>
        builder().buildInputSchema("User", { mode: "create", pick: ["posts"] }),
      ).toThrow();
    });

    it("throws on updatedAt field in pick", () => {
      expect(() =>
        builder().buildInputSchema("User", {
          mode: "create",
          pick: ["updatedAt"],
        }),
      ).toThrow();
    });
  });

  describe("allowNull", () => {
    it("allows null for optional fields when allowNull is true", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["name"],
        allowNull: true,
      });
      expect(parse({ name: null })).toEqual({ name: null });
    });

    it("allows null for optional fields by default", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["name"],
      });
      expect(parse({ name: null })).toEqual({ name: null });
    });

    it("rejects null for optional fields when allowNull is false", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["name"],
        allowNull: false,
      });
      expect(() => parse({ name: null })).toThrow();
    });
  });

  describe("partial", () => {
    it("makes all fields optional when partial is true", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["email", "age"],
        partial: true,
      });
      expect(parse({})).toEqual({});
    });
  });

  describe("refine", () => {
    it("overrides base type with refine function", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["email", "age"],
        refine: {
          email: (base) => (base as z.ZodString).min(10),
        },
      });
      expect(() => parse({ email: "short", age: 25 })).toThrow();
      expect(parse({ email: "longenough@example.com", age: 25 })).toBeTruthy();
    });

    it("refine bypasses @zod chain", () => {
      const { parse } = builder().buildInputSchema("User", {
        mode: "create",
        pick: ["email", "age"],
        refine: {
          email: (base) => (base as z.ZodString).min(1),
        },
      });
      expect(parse({ email: "not-an-email", age: 25 })).toEqual({
        email: "not-an-email",
        age: 25,
      });
    });
  });

  describe("unknown model", () => {
    it("throws on unknown model", () => {
      expect(() =>
        builder().buildInputSchema("Unknown", { mode: "create" }),
      ).toThrow("Unknown model");
    });
  });
});

describe("buildModelSchema", () => {
  it("includes all scalar fields by default", () => {
    const schema = builder().buildModelSchema("Post", {});
    const result = schema.parse({
      id: "p1",
      title: "hello",
      content: null,
      authorId: "u1",
    });
    expect(result).toEqual({
      id: "p1",
      title: "hello",
      content: null,
      authorId: "u1",
    });
  });

  it("pick limits scalar fields", () => {
    const schema = builder().buildModelSchema("Post", {
      pick: ["id", "title"],
    });
    const result = schema.parse({ id: "p1", title: "hello" });
    expect(result).toEqual({ id: "p1", title: "hello" });
  });

  it("omit excludes scalar fields", () => {
    const schema = builder().buildModelSchema("Post", { omit: ["content"] });
    const result = schema.parse({ id: "p1", title: "hello", authorId: "u1" });
    expect(result).toEqual({ id: "p1", title: "hello", authorId: "u1" });
  });

  it("makes nullable fields nullable", () => {
    const schema = builder().buildModelSchema("Post", { pick: ["content"] });
    expect(schema.parse({ content: null })).toEqual({ content: null });
    expect(schema.parse({ content: "text" })).toEqual({ content: "text" });
  });

  it("includes relations via include", () => {
    const schema = builder().buildModelSchema("User", {
      pick: ["id", "email"],
      include: {
        posts: { pick: ["id", "title"] },
      },
    });
    const result = schema.parse({
      id: "u1",
      email: "a@b.com",
      posts: [{ id: "p1", title: "hello" }],
    });
    expect(result.posts).toEqual([{ id: "p1", title: "hello" }]);
  });

  it("wraps list relations in array", () => {
    const schema = builder().buildModelSchema("User", {
      pick: ["id"],
      include: { posts: { pick: ["id"] } },
    });
    expect(() => schema.parse({ id: "u1", posts: { id: "p1" } })).toThrow();
  });

  it("makes optional singular relations nullable", () => {
    const schema = builder().buildModelSchema("User", {
      pick: ["id"],
      include: { profile: { pick: ["id"] } },
    });
    expect(schema.parse({ id: "u1", profile: null })).toEqual({
      id: "u1",
      profile: null,
    });
  });

  it("enforces strict mode", () => {
    const schema = builder().buildModelSchema("Post", {
      pick: ["id"],
      strict: true,
    });
    expect(() => schema.parse({ id: "p1", extra: true })).toThrow();
  });

  it("throws on maxDepth exceeded", () => {
    expect(() =>
      builder().buildModelSchema("User", {
        maxDepth: 1,
        include: {
          posts: {
            include: {
              author: {},
            },
          },
        },
      }),
    ).toThrow("Maximum include depth");
  });

  it("throws on unknown model", () => {
    expect(() => builder().buildModelSchema("Unknown", {})).toThrow(
      "Unknown model",
    );
  });

  it("throws on unknown field in pick", () => {
    expect(() =>
      builder().buildModelSchema("Post", { pick: ["nonexistent"] }),
    ).toThrow();
  });

  it("throws on relation field in pick without include", () => {
    expect(() =>
      builder().buildModelSchema("User", { pick: ["posts"] }),
    ).toThrow("relation");
  });

  it("throws on non-relation field in include", () => {
    expect(() =>
      builder().buildModelSchema("User", { include: { email: {} } }),
    ).toThrow("not a relation");
  });
});

describe("buildFieldSchema caching", () => {
  it("returns same validation for repeated calls", () => {
    const b = builder();
    const s1 = b.buildFieldSchema("User", "email");
    const s2 = b.buildFieldSchema("User", "email");
    expect(() => s1.parse("not-email")).toThrow();
    expect(() => s2.parse("not-email")).toThrow();
    expect(s1.parse("a@b.com")).toBe("a@b.com");
  });
});