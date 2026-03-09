import { describe, it, expect } from "vitest";
import { createGuard } from "../../src/runtime/guard.js";
import type {
  TypeMap,
  EnumMap,
  ZodChains,
  ScopeMap,
  GuardGeneratedConfig,
} from "../../src/shared/types.js";

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
};

const ENUM_MAP: EnumMap = {};
const ZOD_CHAINS: ZodChains = {};
const SCOPE_MAP: ScopeMap = {
  User: [{ fk: "companyId", root: "Company", relationName: "company" }],
};
const GUARD_CONFIG: GuardGeneratedConfig = { onMissingScopeContext: "error" };

function makeGuard() {
  return createGuard<typeof TYPE_MAP, "Company">({
    typeMap: TYPE_MAP,
    enumMap: ENUM_MAP,
    zodChains: ZOD_CHAINS,
    scopeMap: SCOPE_MAP,
    guardConfig: GUARD_CONFIG,
  });
}

describe("createGuard facade", () => {
  it("input() delegates to schemaBuilder and returns parseable schema", () => {
    const guard = makeGuard();
    const schema = guard.input("User", { mode: "create", pick: ["email"] });
    expect(schema.parse).toBeTypeOf("function");
    expect(schema.schema).toBeDefined();
    const result = schema.parse({ email: "test@example.com" });
    expect(result).toEqual({ email: "test@example.com" });
  });

  it("model() delegates to schemaBuilder and returns zod schema", () => {
    const guard = makeGuard();
    const schema = guard.model("User", { pick: ["id", "email"] });
    expect(schema.parse).toBeTypeOf("function");
    const result = schema.parse({ id: "abc", email: "test@example.com" });
    expect(result).toEqual({ id: "abc", email: "test@example.com" });
  });

  it("query() delegates to queryBuilder and returns parseable schema", () => {
    const guard = makeGuard();
    const schema = guard.query("User", "findMany", {
      where: { email: { contains: true } },
    });
    expect(schema.parse).toBeTypeOf("function");
    expect(schema.schemas).toBeDefined();
    const result = schema.parse({ where: { email: { contains: "test" } } });
    expect(result.where).toEqual({ email: { contains: "test" } });
  });

  it("query() with context function delegates correctly", () => {
    const guard = makeGuard();
    const schema = guard.query<{ companyId: string }>(
      "User",
      "findMany",
      (ctx) => ({
        where: { companyId: { equals: ctx.companyId } },
      }),
    );
    const result = schema.parse({}, { ctx: { companyId: "c1" } });
    expect(result.where).toEqual({ companyId: { equals: "c1" } });
  });

  it("query() with caller map delegates correctly", () => {
    const guard = makeGuard();
    const schema = guard.query("User", "findMany", {
      "/admin": { where: { email: { contains: true } } },
    });
    const result = schema.parse(
      { where: { email: { contains: "x" } } },
      { caller: "/admin" },
    );
    expect(result.where).toEqual({ email: { contains: "x" } });
  });

  it("extension() returns a Prisma extension object", () => {
    const guard = makeGuard();
    const ext = guard.extension(() => ({ Company: "c1" }));
    expect(ext.name).toBe("prisma-guard");
    expect(ext.query).toBeDefined();
    expect(ext.query.$allOperations).toBeTypeOf("function");
  });
});