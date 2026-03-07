import { describe, it, expect } from "vitest";
import { createModelGuardExtension } from "../../src/runtime/model-guard";
import { ShapeError, CallerError } from "../../src/shared/errors";
import type {
  TypeMap,
  EnumMap,
  ZodChains,
  UniqueMap,
} from "../../src/shared/types";

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
    description: {
      type: "String",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
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
    tenantId: {
      type: "String",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    tenant: {
      type: "Tenant",
      isList: false,
      isRequired: true,
      isId: false,
      isRelation: true,
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
  },
};

const enumMap: EnumMap = {};
const zodChains: ZodChains = {};
const uniqueMap: UniqueMap = {
  Project: [["id"]],
  Task: [["id"]],
};

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

function makeExtension(
  opts: {
    contextFn?: () => Record<string, unknown>;
  } = {},
) {
  return createModelGuardExtension({
    typeMap,
    enumMap,
    zodChains,
    uniqueMap,
    scopeMap: {
      Project: [{ fk: 'tenantId', root: 'Tenant', relationName: 'tenant' }],
    },
    contextFn: opts.contextFn ?? (() => ({})),
  });
}

describe("model-guard", () => {
  describe("read methods", () => {
    it("findMany validates where shape and passes through", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { title: { contains: true } },
        },
      );

      guarded.findMany({
        where: { title: { contains: "test" } },
      });

      expect(calls.findMany.length).toBe(1);
      expect(calls.findMany[0].where).toEqual({
        title: { contains: "test" },
      });
    });

    it("findMany with empty body", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { title: { contains: true } },
        },
      );

      guarded.findMany({});

      expect(calls.findMany.length).toBe(1);
    });

    it("findMany rejects data in shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { title: { contains: true } },
        },
      );

      expect(() => guarded.findMany({})).toThrow(ShapeError);
    });

    it("findFirst passes through", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { title: { contains: true } },
        },
      );

      guarded.findFirst({ where: { title: { contains: "x" } } });
      expect(calls.findFirst.length).toBe(1);
    });

    it("count passes through", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { title: { contains: true } },
        },
      );

      guarded.count({ where: { title: { contains: "x" } } });
      expect(calls.count.length).toBe(1);
    });

    it("findMany with undefined body", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {},
      );

      guarded.findMany();
      expect(calls.findMany.length).toBe(1);
    });
  });

  describe("create methods", () => {
    it("create validates and passes data", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true, status: true },
        },
      );

      guarded.create({ data: { title: "New", status: "active" } });

      expect(calls.create.length).toBe(1);
      expect(calls.create[0]).toEqual({
        data: { title: "New", status: "active" },
      });
    });

    it("create with forced value overrides client", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true, status: "draft" },
        },
      );

      guarded.create({ data: { title: "New" } });

      expect(calls.create[0].data).toEqual({
        title: "New",
        status: "draft",
      });
    });

    it("create rejects missing data shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { id: { equals: true } },
        },
      );

      expect(() => guarded.create({ data: { title: "x" } })).toThrow(
        ShapeError,
      );
    });

    it("create rejects missing data in body", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() => guarded.create({})).toThrow(ShapeError);
    });

    it("create rejects unknown body keys", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() =>
        guarded.create({
          data: { title: "x" },
          select: { id: true },
        }),
      ).toThrow(ShapeError);
    });

    it("create rejects include in body", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() =>
        guarded.create({
          data: { title: "x" },
          include: { tasks: true },
        }),
      ).toThrow(ShapeError);
    });

    it("createMany validates array data", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      guarded.createMany({
        data: [{ title: "A" }, { title: "B" }],
      });

      expect(calls.createMany.length).toBe(1);
      expect(calls.createMany[0].data).toEqual([
        { title: "A" },
        { title: "B" },
      ]);
    });

    it("createMany rejects non-array data", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() => guarded.createMany({ data: { title: "x" } })).toThrow(
        ShapeError,
      );
    });

    it("createMany rejects empty array", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() => guarded.createMany({ data: [] })).toThrow(ShapeError);
    });

    it("createManyAndReturn validates array data", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      guarded.createManyAndReturn({ data: [{ title: "A" }] });
      expect(calls.createManyAndReturn.length).toBe(1);
    });
  });

  describe("update methods", () => {
    it("update validates data and where", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { id: { equals: true } },
        },
      );

      guarded.update({
        data: { title: "Updated" },
        where: { id: { equals: "abc" } },
      });

      expect(calls.update.length).toBe(1);
      expect(calls.update[0].data).toEqual({ title: "Updated" });
      expect(calls.update[0].where).toEqual({ id: { equals: "abc" } });
    });

    it("update rejects missing data shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { id: { equals: true } },
        },
      );

      expect(() =>
        guarded.update({
          data: { title: "x" },
          where: { id: { equals: "abc" } },
        }),
      ).toThrow(ShapeError);
    });

    it("update requires non-empty where", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() => guarded.update({ data: { title: "x" } })).toThrow(
        ShapeError,
      );
    });

    it("update rejects unknown body keys", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { id: { equals: true } },
        },
      );

      expect(() =>
        guarded.update({
          data: { title: "x" },
          where: { id: { equals: "abc" } },
          select: { id: true },
        }),
      ).toThrow(ShapeError);
    });

    it("update makes data fields optional", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true, status: true },
          where: { id: { equals: true } },
        },
      );

      guarded.update({
        data: { title: "Only title" },
        where: { id: { equals: "abc" } },
      });

      expect(calls.update[0].data).toEqual({ title: "Only title" });
    });

    it("update allows nullable fields to accept null", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { description: true },
          where: { id: { equals: true } },
        },
      );

      guarded.update({
        data: { description: null },
        where: { id: { equals: "abc" } },
      });

      expect(calls.update[0].data).toEqual({ description: null });
    });
  });

  describe("bulk mutation where requirement (H2)", () => {
    it("updateMany requires where shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() =>
        guarded.updateMany({
          data: { title: "x" },
        }),
      ).toThrow(ShapeError);
    });

    it("updateMany rejects empty resolved where", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { status: { equals: true } },
        },
      );

      expect(() =>
        guarded.updateMany({
          data: { title: "x" },
        }),
      ).toThrow(ShapeError);
    });

    it("updateMany succeeds with where", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { status: { equals: true } },
        },
      );

      guarded.updateMany({
        data: { title: "x" },
        where: { status: { equals: "draft" } },
      });

      expect(calls.updateMany.length).toBe(1);
      expect(calls.updateMany[0].where).toEqual({
        status: { equals: "draft" },
      });
    });

    it("updateMany succeeds with forced where", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { status: { equals: "draft" } },
        },
      );

      guarded.updateMany({
        data: { title: "x" },
      });

      expect(calls.updateMany.length).toBe(1);
      expect(calls.updateMany[0].where).toEqual({
        status: { equals: "draft" },
      });
    });

    it("updateManyAndReturn requires where shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() =>
        guarded.updateManyAndReturn({
          data: { title: "x" },
        }),
      ).toThrow(ShapeError);
    });

    it("deleteMany requires where shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {},
      );

      expect(() => guarded.deleteMany({})).toThrow(ShapeError);
    });

    it("deleteMany rejects empty resolved where", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { status: { equals: true } },
        },
      );

      expect(() => guarded.deleteMany({})).toThrow(ShapeError);
    });

    it("deleteMany succeeds with where", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { status: { equals: true } },
        },
      );

      guarded.deleteMany({
        where: { status: { equals: "draft" } },
      });

      expect(calls.deleteMany.length).toBe(1);
    });

    it("deleteMany succeeds with forced where", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { status: { equals: "archived" } },
        },
      );

      guarded.deleteMany({});

      expect(calls.deleteMany.length).toBe(1);
      expect(calls.deleteMany[0].where).toEqual({
        status: { equals: "archived" },
      });
    });
  });

  describe("delete methods", () => {
    it("delete validates where", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { id: { equals: true } },
        },
      );

      guarded.delete({ where: { id: { equals: "abc" } } });

      expect(calls.delete.length).toBe(1);
      expect(calls.delete[0].where).toEqual({ id: { equals: "abc" } });
    });

    it("delete rejects data in shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { id: { equals: true } },
        },
      );

      expect(() =>
        guarded.delete({ where: { id: { equals: "abc" } } }),
      ).toThrow(ShapeError);
    });

    it("delete requires non-empty where", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {},
      );

      expect(() => guarded.delete({})).toThrow(ShapeError);
    });

    it("delete rejects unknown body keys", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { id: { equals: true } },
        },
      );

      expect(() =>
        guarded.delete({
          where: { id: { equals: "abc" } },
          select: { id: true },
        }),
      ).toThrow(ShapeError);
    });
  });

  describe("data shape validation", () => {
    it("rejects relation field in data shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true, tenant: true },
        },
      );

      expect(() => guarded.create({ data: { title: "x" } })).toThrow(
        ShapeError,
      );
    });

    it("rejects updatedAt field in data shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true, updatedAt: true },
        },
      );

      expect(() => guarded.create({ data: { title: "x" } })).toThrow(
        ShapeError,
      );
    });

    it("rejects unknown field in data shape", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true, nonexistent: true },
        },
      );

      expect(() => guarded.create({ data: { title: "x" } })).toThrow(
        ShapeError,
      );
    });

    it("rejects invalid forced data value", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: 123 },
        },
      );

      expect(() => guarded.create({ data: {} })).toThrow(ShapeError);
    });

    it("rejects extra fields in strict data", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() =>
        guarded.create({ data: { title: "x", status: "extra" } }),
      ).toThrow();
    });
  });

  describe("named shapes / caller routing", () => {
    it("routes to correct shape by caller", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          "/admin/projects": {
            data: { title: true, status: true },
          },
          "/public/projects": {
            data: { title: true },
          },
        },
      );

      guarded.create({
        caller: "/admin/projects",
        data: { title: "New", status: "active" },
      });

      expect(calls.create.length).toBe(1);
      expect(calls.create[0].data).toEqual({
        title: "New",
        status: "active",
      });
    });

    it("rejects missing caller", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          "/admin/projects": {
            data: { title: true },
          },
        },
      );

      expect(() => guarded.create({ data: { title: "x" } })).toThrow(
        CallerError,
      );
    });

    it("rejects unknown caller", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          "/admin/projects": {
            data: { title: true },
          },
        },
      );

      expect(() =>
        guarded.create({
          caller: "/unknown/route",
          data: { title: "x" },
        }),
      ).toThrow(CallerError);
    });

    it("matches parameterized caller pattern", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          "/projects/:id": {
            data: { title: true },
            where: { id: { equals: true } },
          },
        },
      );

      guarded.update({
        caller: "/projects/abc123",
        data: { title: "Updated" },
        where: { id: { equals: "abc123" } },
      });

      expect(calls.update.length).toBe(1);
    });

    it("strips caller from body before validation", () => {
      const ext = makeExtension();
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          "/admin": {
            where: { title: { contains: true } },
          },
        },
      );

      guarded.findMany({
        caller: "/admin",
        where: { title: { contains: "x" } },
      });

      expect(calls.findMany.length).toBe(1);
    });
  });

  describe("context-dependent shapes", () => {
    it("resolves shape function with context", () => {
      const ext = makeExtension({
        contextFn: () => ({ role: "admin" }),
      });
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        (ctx: any) => ({
          data: { title: true },
          ...(ctx.role === "admin" ? { where: { id: { equals: true } } } : {}),
        }),
      );

      guarded.update({
        data: { title: "x" },
        where: { id: { equals: "abc" } },
      });

      expect(calls.update.length).toBe(1);
    });

    it("resolves named shape function with context", () => {
      const ext = makeExtension({
        contextFn: () => ({ role: "editor" }),
      });
      const { calls, handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          "/projects": (ctx: any) => ({
            data:
              ctx.role === "admin"
                ? { title: true, status: true }
                : { title: true },
          }),
        },
      );

      guarded.create({
        caller: "/projects",
        data: { title: "x" },
      });

      expect(calls.create.length).toBe(1);
    });
  });

  describe("body validation", () => {
    it("rejects non-object body for named shapes", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          "/admin": { data: { title: true } },
        },
      );

      expect(() => guarded.create("not an object")).toThrow(ShapeError);
    });

    it("rejects non-object body for mutations", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
        },
      );

      expect(() => guarded.create("string")).toThrow(ShapeError);
    });
  });

  describe("where shape without body where", () => {
    it("rejects where in body when shape has no where", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { id: { equals: true } },
        },
      );

      guarded.update({
        data: { title: "x" },
        where: { id: { equals: "abc" } },
      });
    });
  });

  describe("unique where validation on mutations", () => {
    it("update validates where covers unique constraint", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          data: { title: true },
          where: { title: { equals: true } },
        },
      );

      expect(() =>
        guarded.update({
          data: { title: "x" },
          where: { title: { equals: "y" } },
        }),
      ).toThrow(ShapeError);
    });

    it("delete validates where covers unique constraint", () => {
      const ext = makeExtension();
      const { handler } = makeDelegateMock();

      const guarded = ext.$allModels.guard.call(
        {
          $name: "Project",
          $parent: { project: handler },
        } as any,
        {
          where: { title: { equals: true } },
        },
      );

      expect(() =>
        guarded.delete({
          where: { title: { equals: "y" } },
        }),
      ).toThrow(ShapeError);
    });
  });
});
