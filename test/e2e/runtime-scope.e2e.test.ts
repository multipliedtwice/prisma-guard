import { describe, it, expect } from "vitest";
import { createGuard } from "../../src/runtime/guard";
import { PolicyError, ShapeError } from "../../src/shared/errors";

function makeQueryRecorder(mockResult?: any) {
  const calls: any[] = [];
  const query = async (args: any) => {
    calls.push(args);
    return args.__mockResult ?? mockResult ?? { id: "x", tenantId: "t1" };
  };
  return { calls, query };
}

function makeGuard(
  opts: {
    scopeMap?: Record<
      string,
      { fk: string; root: string; relationName: string }[]
    >;
    onMissingScopeContext?: "error" | "warn" | "ignore";
    logger?: { warn: (msg: string) => void };
  } = {},
) {
  return createGuard({
    typeMap: {} as any,
    enumMap: {} as any,
    zodChains: {} as any,
    scopeMap: opts.scopeMap ?? {
      Project: [{ fk: "tenantId", root: "Tenant", relationName: "tenant" }],
    },
    guardConfig: {
      onMissingScopeContext: opts.onMissingScopeContext ?? "error",
      findUniqueMode: "verify",
    },
    logger: opts.logger,
  });
}

describe("e2e: runtime scope extension", () => {
  describe("read operations", () => {
    it("adds scope to findMany where AND", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "findMany",
        args: { where: { title: { equals: "a" } } },
        query,
      });

      expect(calls.length).toBe(1);
      expect(calls[0].where).toEqual({
        AND: [{ title: { equals: "a" } }, { tenantId: "t1" }],
      });
    });

    it("adds scope to findMany with no existing where", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "findMany",
        args: {},
        query,
      });

      expect(calls[0].where).toEqual({ tenantId: "t1" });
    });

    it("adds scope to findFirst", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "findFirst",
        args: { where: { title: { equals: "x" } } },
        query,
      });

      expect(calls[0].where).toEqual({
        AND: [{ title: { equals: "x" } }, { tenantId: "t1" }],
      });
    });

    it("adds scope to findFirstOrThrow", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "findFirstOrThrow",
        args: { where: { title: { equals: "x" } } },
        query,
      });

      expect(calls[0].where).toEqual({
        AND: [{ title: { equals: "x" } }, { tenantId: "t1" }],
      });
    });

    it("adds scope to count", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder(5);

      await ext.query.$allOperations({
        model: "Project",
        operation: "count",
        args: {},
        query,
      });

      expect(calls[0].where).toEqual({ tenantId: "t1" });
    });

    it("adds scope to aggregate", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder({});

      await ext.query.$allOperations({
        model: "Project",
        operation: "aggregate",
        args: { _count: true },
        query,
      });

      expect(calls[0].where).toEqual({ tenantId: "t1" });
    });

    it("adds scope to groupBy", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder([]);

      await ext.query.$allOperations({
        model: "Project",
        operation: "groupBy",
        args: { by: ["title"] },
        query,
      });

      expect(calls[0].where).toEqual({ tenantId: "t1" });
      expect(calls[0].by).toEqual(["title"]);
    });

    it("throws on groupBy without by argument", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { query } = makeQueryRecorder();

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "groupBy",
          args: {},
          query,
        }),
      ).toThrow(ShapeError);
    });
  });

  describe("findUnique operations", () => {
    it("injects missing FKs into select and strips them from result", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const calls: any[] = [];
      const query = async (args: any) => {
        calls.push(args);
        return { id: "p1", tenantId: "t1", title: "x" };
      };

      const out = await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" }, select: { id: true, title: true } },
        query,
      });

      expect(calls.length).toBe(1);
      expect(calls[0].select).toEqual({
        id: true,
        title: true,
        tenantId: true,
      });
      expect(out).toEqual({ id: "p1", title: "x" });
    });

    it("does not strip FK when select already includes it", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const calls: any[] = [];
      const query = async (args: any) => {
        calls.push(args);
        return { id: "p1", tenantId: "t1", title: "x" };
      };

      const out = await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: {
          where: { id: "p1" },
          select: { id: true, title: true, tenantId: true },
        },
        query,
      });

      expect(calls[0].select).toEqual({
        id: true,
        title: true,
        tenantId: true,
      });
      expect(out).toEqual({ id: "p1", tenantId: "t1", title: "x" });
    });

    it("returns null for findUnique when record is out of scope", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const query = async () => ({ id: "p1", tenantId: "t2", title: "x" });

      const out = await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" } },
        query,
      });

      expect(out).toBeNull();
    });

    it("returns result for findUnique when record is in scope", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const query = async () => ({ id: "p1", tenantId: "t1", title: "x" });

      const out = await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" } },
        query,
      });

      expect(out).toEqual({ id: "p1", tenantId: "t1", title: "x" });
    });

    it("returns null when findUnique result is null", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const query = async () => null;

      const out = await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" } },
        query,
      });

      expect(out).toBeNull();
    });

    it("throws PolicyError for findUniqueOrThrow when out of scope", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const query = async () => ({ id: "p1", tenantId: "t2" });

      await expect(
        ext.query.$allOperations({
          model: "Project",
          operation: "findUniqueOrThrow",
          args: { where: { id: "p1" } },
          query,
        }),
      ).rejects.toThrow(PolicyError);
    });

    it("does not pass internal keys to query function", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const calls: any[] = [];
      const query = async (args: any) => {
        calls.push(args);
        return { id: "p1", tenantId: "t1" };
      };

      await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" } },
        query,
      });

      for (const call of calls) {
        expect(call).not.toHaveProperty("__prisma_guard_internal_bypass__");
      }
    });

    it("does not pass internal keys to query on verification path", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const calls: any[] = [];
      let n = 0;
      const query = async (args: any) => {
        calls.push(args);
        return ++n === 1 ? { id: "p1" } : { tenantId: "t1" };
      };

      await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" } },
        query,
      });

      expect(calls.length).toBe(2);
      for (const call of calls) {
        expect(call).not.toHaveProperty("__prisma_guard_internal_bypass__");
      }
    });
  });

  describe("findUnique verification query path", () => {
    it("verifies scope via second query when result lacks FK", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      let n = 0;
      const query = async () => (++n === 1 ? { id: "p1" } : { tenantId: "t1" });

      const out = await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" } },
        query,
      });

      expect(n).toBe(2);
      expect(out).toEqual({ id: "p1" });
    });

    it("returns null when verification shows FK mismatch", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      let n = 0;
      const query = async () => (++n === 1 ? { id: "p1" } : { tenantId: "t2" });

      const out = await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" } },
        query,
      });

      expect(out).toBeNull();
    });

    it("throws PolicyError when verification query returns null", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      let n = 0;
      const query = async () => (++n === 1 ? { id: "p1" } : null);

      await expect(
        ext.query.$allOperations({
          model: "Project",
          operation: "findUnique",
          args: { where: { id: "p1" } },
          query,
        }),
      ).rejects.toThrow(PolicyError);
    });

    it("throws PolicyError when verification query throws", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      let n = 0;
      const query = async () => {
        if (++n > 1) throw new Error("connection lost");
        return { id: "p1" };
      };

      await expect(
        ext.query.$allOperations({
          model: "Project",
          operation: "findUnique",
          args: { where: { id: "p1" } },
          query,
        }),
      ).rejects.toThrow(PolicyError);
    });

    it("throws PolicyError when verification needed but where is invalid", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));

      const query = async () => ({ id: "p1" });

      await expect(
        ext.query.$allOperations({
          model: "Project",
          operation: "findUnique",
          args: { where: null },
          query,
        }),
      ).rejects.toThrow(PolicyError);
    });
  });

  describe("findUnique multi-root select injection", () => {
    it("injects only missing FKs and strips only those from result", async () => {
      const guard = makeGuard({
        scopeMap: {
          Assignment: [
            { fk: "companyId", root: "Company", relationName: "company" },
            { fk: "userId", root: "User", relationName: "user" },
          ],
        },
      });
      const ext = guard.extension(() => ({ Company: "c1", User: "u1" }));
      const calls: any[] = [];
      const query = async (args: any) => {
        calls.push(args);
        return { id: "a1", companyId: "c1", userId: "u1", title: "x" };
      };

      const out = await ext.query.$allOperations({
        model: "Assignment",
        operation: "findUnique",
        args: {
          where: { id: "a1" },
          select: { id: true, title: true, companyId: true },
        },
        query,
      });

      expect(calls[0].select).toEqual({
        id: true,
        title: true,
        companyId: true,
        userId: true,
      });
      expect(out).toEqual({ id: "a1", companyId: "c1", title: "x" });
    });
  });

  describe("create operations", () => {
    it("overrides FK in create data", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "create",
        args: { data: { title: "new", tenantId: "attempt-override" } },
        query,
      });

      expect(calls[0].data).toEqual({ title: "new", tenantId: "t1" });
    });

    it("injects FK into create data when not provided", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "create",
        args: { data: { title: "new" } },
        query,
      });

      expect(calls[0].data).toEqual({ title: "new", tenantId: "t1" });
    });

    it("overrides FK in each createMany item", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder({ count: 2 });

      await ext.query.$allOperations({
        model: "Project",
        operation: "createMany",
        args: {
          data: [{ title: "a", tenantId: "wrong" }, { title: "b" }],
        },
        query,
      });

      expect(calls[0].data).toEqual([
        { title: "a", tenantId: "t1" },
        { title: "b", tenantId: "t1" },
      ]);
    });

    it("overrides FK in each createManyAndReturn item", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder([]);

      await ext.query.$allOperations({
        model: "Project",
        operation: "createManyAndReturn",
        args: { data: [{ title: "a" }] },
        query,
      });

      expect(calls[0].data).toEqual([{ title: "a", tenantId: "t1" }]);
    });

    it("throws ShapeError on createMany with empty data array", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { query } = makeQueryRecorder();

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "createMany",
          args: { data: [] },
          query,
        }),
      ).toThrow(ShapeError);
    });

    it("throws ShapeError on createManyAndReturn with empty data array", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { query } = makeQueryRecorder();

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "createManyAndReturn",
          args: { data: [] },
          query,
        }),
      ).toThrow(ShapeError);
    });
  });

  describe("update operations", () => {
    it("adds scope to where and strips FK from data on update", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "update",
        args: {
          where: { id: "p1" },
          data: { title: "updated", tenantId: "attempt-change" },
        },
        query,
      });

      expect(calls[0].where).toEqual({
        id: "p1",
        AND: [{ tenantId: "t1" }],
      });
      expect(calls[0].data).toEqual({ title: "updated" });
      expect(calls[0].data.tenantId).toBeUndefined();
    });

    it("adds scope to updateMany where", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder({ count: 1 });

      await ext.query.$allOperations({
        model: "Project",
        operation: "updateMany",
        args: {
          where: { title: { equals: "old" } },
          data: { title: "new" },
        },
        query,
      });

      expect(calls[0].where).toEqual({
        AND: [{ title: { equals: "old" } }, { tenantId: "t1" }],
      });
    });

    it("adds scope to updateManyAndReturn where and strips FK from data", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder([]);

      await ext.query.$allOperations({
        model: "Project",
        operation: "updateManyAndReturn",
        args: {
          where: { title: { equals: "old" } },
          data: { title: "new", tenantId: "attempt-change" },
        },
        query,
      });

      expect(calls[0].where).toEqual({
        AND: [{ title: { equals: "old" } }, { tenantId: "t1" }],
      });
      expect(calls[0].data).toEqual({ title: "new" });
      expect(calls[0].data.tenantId).toBeUndefined();
    });
  });

  describe("delete operations", () => {
    it("adds scope to delete where", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "delete",
        args: { where: { id: "p1" } },
        query,
      });

      expect(calls[0].where).toEqual({
        id: "p1",
        AND: [{ tenantId: "t1" }],
      });
    });

    it("adds scope to deleteMany where", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder({ count: 3 });

      await ext.query.$allOperations({
        model: "Project",
        operation: "deleteMany",
        args: { where: { title: { equals: "gone" } } },
        query,
      });

      expect(calls[0].where).toEqual({
        AND: [{ title: { equals: "gone" } }, { tenantId: "t1" }],
      });
    });

    it("passes through deleteMany args that have no data field", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder({ count: 0 });

      await ext.query.$allOperations({
        model: "Project",
        operation: "deleteMany",
        args: { where: {} },
        query,
      });

      expect(calls[0].where).toEqual({
        AND: [{}, { tenantId: "t1" }],
      });
      expect(calls[0].data).toBeUndefined();
    });
  });

  describe("upsert", () => {
    it("throws PolicyError for upsert on scoped model", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { query } = makeQueryRecorder();

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "upsert",
          args: {
            where: { id: "p1" },
            create: { title: "new" },
            update: { title: "updated" },
          },
          query,
        }),
      ).toThrow(PolicyError);
    });
  });

  describe("missing scope context", () => {
    it("throws PolicyError for missing scope context on mutation", () => {
      const guard = makeGuard({ onMissingScopeContext: "error" });
      const ext = guard.extension(() => ({}));
      const query = async (args: any) => args;

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "create",
          args: { data: { title: "x" } },
          query,
        }),
      ).toThrow(PolicyError);
    });

    it("throws PolicyError on read when onMissingScopeContext is error", () => {
      const guard = makeGuard({ onMissingScopeContext: "error" });
      const ext = guard.extension(() => ({}));
      const query = async (args: any) => args;

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "findMany",
          args: {},
          query,
        }),
      ).toThrow(PolicyError);
    });

    it("mutations always throw even when onMissingScopeContext is warn", () => {
      const guard = makeGuard({ onMissingScopeContext: "warn" });
      const ext = guard.extension(() => ({}));
      const query = async (args: any) => args;

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "create",
          args: { data: { title: "x" } },
          query,
        }),
      ).toThrow(PolicyError);
    });

    it("mutations always throw even when onMissingScopeContext is ignore", () => {
      const guard = makeGuard({ onMissingScopeContext: "ignore" });
      const ext = guard.extension(() => ({}));
      const query = async (args: any) => args;

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "create",
          args: { data: { title: "x" } },
          query,
        }),
      ).toThrow(PolicyError);
    });

    it("proceeds on read when onMissingScopeContext is ignore", async () => {
      const guard = makeGuard({ onMissingScopeContext: "ignore" });
      const ext = guard.extension(() => ({}));
      const { calls, query } = makeQueryRecorder([]);

      await ext.query.$allOperations({
        model: "Project",
        operation: "findMany",
        args: { where: { title: { equals: "a" } } },
        query,
      });

      expect(calls[0].where).toEqual({ title: { equals: "a" } });
    });
  });

  describe("warn mode on read", () => {
    it("applies only present scope conditions with partial context", async () => {
      const guard = makeGuard({
        scopeMap: {
          Assignment: [
            { fk: "companyId", root: "Company", relationName: "company" },
            { fk: "userId", root: "User", relationName: "user" },
          ],
        },
        onMissingScopeContext: "warn",
      });
      const ext = guard.extension(() => ({ Company: "c1" }));
      const { calls, query } = makeQueryRecorder([]);

      await ext.query.$allOperations({
        model: "Assignment",
        operation: "findMany",
        args: {},
        query,
      });

      expect(calls[0].where).toEqual({ companyId: "c1" });
    });

    it("passes through when all roots missing", async () => {
      const guard = makeGuard({ onMissingScopeContext: "warn" });
      const ext = guard.extension(() => ({}));
      const { calls, query } = makeQueryRecorder([]);

      await ext.query.$allOperations({
        model: "Project",
        operation: "findMany",
        args: { where: { title: { equals: "a" } } },
        query,
      });

      expect(calls[0].where).toEqual({ title: { equals: "a" } });
    });

    it("uses custom logger for warn messages", async () => {
      const warnings: string[] = [];
      const guard = makeGuard({
        onMissingScopeContext: "warn",
        logger: { warn: (msg) => warnings.push(msg) },
      });
      const ext = guard.extension(() => ({}));
      const { query } = makeQueryRecorder([]);

      await ext.query.$allOperations({
        model: "Project",
        operation: "findMany",
        args: {},
        query,
      });

      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("Missing scope context");
    });
  });

  describe("unscoped models pass through", () => {
    it("passes through for models not in scope map", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Tenant",
        operation: "findMany",
        args: { where: { name: { equals: "test" } } },
        query,
      });

      expect(calls[0].where).toEqual({ name: { equals: "test" } });
    });

    it("passes through when model is undefined", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: undefined,
        operation: "queryRaw",
        args: {},
        query,
      });

      expect(calls[0]).toEqual({});
    });
  });

  describe("multiple scope roots", () => {
    it("adds conditions for all scope roots", async () => {
      const guard = makeGuard({
        scopeMap: {
          Assignment: [
            { fk: "companyId", root: "Company", relationName: "company" },
            { fk: "userId", root: "User", relationName: "user" },
          ],
        },
      });
      const ext = guard.extension(() => ({ Company: "c1", User: "u1" }));
      const { calls, query } = makeQueryRecorder([]);

      await ext.query.$allOperations({
        model: "Assignment",
        operation: "findMany",
        args: {},
        query,
      });

      expect(calls[0].where).toEqual({
        AND: [{ companyId: "c1" }, { userId: "u1" }],
      });
    });

    it("overrides all FKs on create with multiple roots", async () => {
      const guard = makeGuard({
        scopeMap: {
          Assignment: [
            { fk: "companyId", root: "Company", relationName: "company" },
            { fk: "userId", root: "User", relationName: "user" },
          ],
        },
      });
      const ext = guard.extension(() => ({ Company: "c1", User: "u1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Assignment",
        operation: "create",
        args: { data: { title: "task" } },
        query,
      });

      expect(calls[0].data).toEqual({
        title: "task",
        companyId: "c1",
        userId: "u1",
      });
    });

    it("strips all FKs from update data with multiple roots", async () => {
      const guard = makeGuard({
        scopeMap: {
          Assignment: [
            { fk: "companyId", root: "Company", relationName: "company" },
            { fk: "userId", root: "User", relationName: "user" },
          ],
        },
      });
      const ext = guard.extension(() => ({ Company: "c1", User: "u1" }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Assignment",
        operation: "update",
        args: {
          where: { id: "a1" },
          data: { title: "updated", companyId: "c2", userId: "u2" },
        },
        query,
      });

      expect(calls[0].data).toEqual({ title: "updated" });
    });
  });

  describe("scope value types", () => {
    it("handles numeric scope values", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: 42 }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "findMany",
        args: {},
        query,
      });

      expect(calls[0].where).toEqual({ tenantId: 42 });
    });

    it("handles bigint scope values", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: BigInt(999) }));
      const { calls, query } = makeQueryRecorder();

      await ext.query.$allOperations({
        model: "Project",
        operation: "findMany",
        args: {},
        query,
      });

      expect(calls[0].where).toEqual({ tenantId: BigInt(999) });
    });

    it("findUnique loose-compares string vs number scope values", async () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: 42 }));

      const query = async () => ({ id: "p1", tenantId: "42", title: "x" });

      const out = await ext.query.$allOperations({
        model: "Project",
        operation: "findUnique",
        args: { where: { id: "p1" } },
        query,
      });

      expect(out).toEqual({ id: "p1", tenantId: "42", title: "x" });
    });

    it("throws PolicyError on empty string scope value", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "" }));
      const { query } = makeQueryRecorder();

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "findMany",
          args: {},
          query,
        }),
      ).toThrow(PolicyError);
    });
  });

  describe("data shape validation on scoped mutations", () => {
    it("rejects non-array createMany data", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { query } = makeQueryRecorder({ count: 1 });

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "createMany",
          args: { data: { title: "x" } },
          query,
        }),
      ).toThrow(ShapeError);
    });

    it("throws ShapeError on create with null data", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { query } = makeQueryRecorder();

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "create",
          args: { data: null },
          query,
        }),
      ).toThrow(ShapeError);
    });

    it("throws ShapeError on update with array data", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { query } = makeQueryRecorder();

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "update",
          args: { where: { id: "p1" }, data: [{ title: "x" }] },
          query,
        }),
      ).toThrow(ShapeError);
    });
  });

  describe("unknown operations", () => {
    it("throws ShapeError for unknown operations on scoped models", () => {
      const guard = makeGuard();
      const ext = guard.extension(() => ({ Tenant: "t1" }));
      const { query } = makeQueryRecorder();

      expect(() =>
        ext.query.$allOperations({
          model: "Project",
          operation: "someFutureOp" as any,
          args: {},
          query,
        }),
      ).toThrow(ShapeError);
    });
  });
});
