import { describe, it, expect } from "vitest";
import { createModelGuardExtension } from "../../src/runtime/model-guard.js";
import { ShapeError } from "../../src/shared/errors.js";
import type {
  TypeMap,
  EnumMap,
  ZodChains,
  ZodDefaults,
  UniqueMap,
} from "../../src/shared/types.js";

const typeMap: TypeMap = {
  Project: {
    id: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: true,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
      isUnique: true,
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
    status: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
    },
    tenantId: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    tasks: {
      type: "Task",
      isList: true,
      isRequired: true,
      isId: false,
      isRelation: true,
      hasDefault: false,
      isUpdatedAt: false,
    },
  },
  Task: {
    id: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: true,
      isRelation: false,
      hasDefault: true,
      isUpdatedAt: false,
      isUnique: true,
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
    projectId: {
      type: "String",
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
  },
};

const enumMap: EnumMap = {};
const zodChains: ZodChains = {};
const zodDefaults: ZodDefaults = {};
const uniqueMap: UniqueMap = { Project: [["id"]], Task: [["id"]] };

function makeDelegateMock() {
  const calls: Record<string, any[]> = {};
  const handler: Record<string, (args: any) => any> = {};
  const methods = [
    "findMany",
    "findFirst",
    "findFirstOrThrow",
    "findUnique",
    "findUniqueOrThrow",
    "count",
    "aggregate",
    "groupBy",
    "create",
    "createMany",
    "createManyAndReturn",
    "update",
    "updateMany",
    "updateManyAndReturn",
    "delete",
    "deleteMany",
  ];
  for (const m of methods) {
    calls[m] = [];
    handler[m] = (args: any) => {
      calls[m].push(args);
      return { id: "mock", ...args };
    };
  }
  return { calls, handler };
}

function makeExtension(opts: { wrapZodErrors?: boolean } = {}) {
  return createModelGuardExtension({
    typeMap,
    enumMap,
    zodChains,
    zodDefaults,
    uniqueMap,
    scopeMap: {
      Project: [{ fk: "tenantId", root: "Tenant", relationName: "tenant" }],
    },
    contextFn: () => ({}),
    wrapZodErrors: opts.wrapZodErrors,
  });
}

describe("model-guard projection", () => {
  it("create with include projection", () => {
    const ext = makeExtension();
    const { calls, handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      { data: { title: true }, include: { tasks: true } },
    );

    guarded.create({
      data: { title: "New" },
      include: { tasks: true },
    });

    expect(calls.create.length).toBe(1);
    expect(calls.create[0].include).toEqual({ tasks: true });
  });

  it("create with select projection", () => {
    const ext = makeExtension();
    const { calls, handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      { data: { title: true }, select: { id: true, title: true } },
    );

    guarded.create({
      data: { title: "New" },
      select: { id: true, title: true },
    });

    expect(calls.create.length).toBe(1);
    expect(calls.create[0].select).toEqual({ id: true, title: true });
  });

  it("create rejects body projection when shape has none", () => {
    const ext = makeExtension();
    const { handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      { data: { title: true } },
    );

    expect(() =>
      guarded.create({
        data: { title: "x" },
        include: { tasks: true },
      }),
    ).toThrow(ShapeError);
  });

  it("update with include projection", () => {
    const ext = makeExtension();
    const { calls, handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      {
        data: { title: true },
        where: { id: { equals: true } },
        include: { tasks: true },
      },
    );

    guarded.update({
      data: { title: "Updated" },
      where: { id: { equals: "abc" } },
      include: { tasks: true },
    });

    expect(calls.update.length).toBe(1);
    expect(calls.update[0].include).toEqual({ tasks: true });
  });

  it("delete with select projection", () => {
    const ext = makeExtension();
    const { calls, handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      { where: { id: { equals: true } }, select: { id: true, title: true } },
    );

    guarded.delete({
      where: { id: { equals: "abc" } },
      select: { id: true },
    });

    expect(calls.delete.length).toBe(1);
    expect(calls.delete[0].select).toEqual({ id: true });
  });

  it("shape rejects both select and include in projection", () => {
    const ext = makeExtension();
    const { handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      { data: { title: true }, select: { id: true }, include: { tasks: true } },
    );

    expect(() =>
      guarded.create({
        data: { title: "x" },
        select: { id: true },
      }),
    ).toThrow(ShapeError);
  });

  it("forced where on nested include in mutation projection", () => {
    const ext = makeExtension();
    const { calls, handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      {
        data: { title: true },
        include: {
          tasks: {
            where: { name: { equals: "forced-filter" } },
          },
        },
      },
    );

    guarded.create({
      data: { title: "New" },
      include: { tasks: true },
    });

    expect(calls.create.length).toBe(1);
    expect(calls.create[0].include.tasks).toEqual({
      where: { name: { equals: "forced-filter" } },
    });
  });
});

describe("model-guard wrapZodErrors", () => {
  it("wraps ZodError as ShapeError on data validation failure", () => {
    const ext = makeExtension({ wrapZodErrors: true });
    const { handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      { data: { title: true } },
    );

    expect(() => guarded.create({ data: { title: 123 } })).toThrow(ShapeError);
  });

  it("wraps ZodError as ShapeError on read validation failure", () => {
    const ext = makeExtension({ wrapZodErrors: true });
    const { handler } = makeDelegateMock();

    const guarded = ext.$allModels.guard.call(
      { $name: "Project", $parent: { project: handler } } as any,
      { where: { title: { contains: true } } },
    );

    expect(() =>
      guarded.findMany({ where: { title: { contains: 123 } } }),
    ).toThrow(ShapeError);
  });
});
