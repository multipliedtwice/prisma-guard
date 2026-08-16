// ROUTING unit test for the compact model extension.
//
// The per-model form got its model name from the closure it was built in — one
// `guard` closure per model, each holding its own `key`. A single `$allModels`
// entry has no such closure: it is one function shared by every model, so the
// model name has to come from the extension context (`$name`) and the delegate
// from `this.$parent[<delegateKey>]`, both resolved per call.
//
// SCOPE, and its limit. These invoke `guard` with a hand-built `this`, so they
// prove only what the function does GIVEN a context: which delegate it selects,
// that it touches no other, and that it refuses a missing or unknown model.
// They do NOT prove that Prisma binds `$name` and `$parent` this way — the
// context here is a fake, and a fake cannot establish someone else's behaviour.
// That binding is Prisma's, and only a real extended client demonstrates it;
// that check belongs to consumer validation.
import { describe, it, expect } from "vitest";
import { createGuard } from "../../src/runtime/guard";
import { ShapeError } from "../../src/shared/errors";

function scalar(overrides: Record<string, unknown> = {}) {
  return {
    type: "String",
    isList: false,
    isRequired: true,
    isId: false,
    isRelation: false,
    hasDefault: false,
    isUpdatedAt: false,
    ...overrides,
  };
}

const TYPE_MAP = {
  User: {
    id: scalar({ isId: true, hasDefault: true }),
    email: scalar(),
  },
  Project: {
    id: scalar({ isId: true, hasDefault: true }),
    title: scalar(),
  },
} as never;

function makeGuard() {
  return createGuard({
    typeMap: TYPE_MAP,
    enumMap: {} as never,
    zodChains: {} as never,
    scopeMap: {},
    guardConfig: { onMissingScopeContext: "ignore" },
  });
}

function makeDelegates() {
  const calls: { delegate: string; args: unknown }[] = [];
  const make = (name: string) => ({
    findMany: (args: unknown) => {
      calls.push({ args, delegate: name });
      return Promise.resolve([]);
    },
  });
  return { calls, project: make("project"), user: make("user") };
}

// Prisma binds the extension context as `this` on an $allModels method: `$name`
// is the model, `$parent` the unextended client.
function guardOn(
  ext: { model: unknown },
  ctx: { $name?: string; $parent: unknown },
  input: unknown,
  caller?: string,
) {
  const allModels = (
    ext.model as { $allModels: { guard: (i: unknown, c?: string) => unknown } }
  ).$allModels;
  return allModels.guard.call(ctx, input, caller);
}

describe("e2e: $allModels model resolution", () => {
  it("routes to this.$parent.user when $name is User", async () => {
    const ext = makeGuard().extension(() => ({}));
    const delegates = makeDelegates();

    const guarded = guardOn(
      ext,
      { $name: "User", $parent: delegates },
      { select: { email: true, id: true } },
    ) as { findMany: (a?: unknown) => Promise<unknown> };

    await guarded.findMany();

    expect(delegates.calls.map((c) => c.delegate)).toEqual(["user"]);
  });

  it("routes to this.$parent.project when $name is Project", async () => {
    const ext = makeGuard().extension(() => ({}));
    const delegates = makeDelegates();

    const guarded = guardOn(
      ext,
      { $name: "Project", $parent: delegates },
      { select: { id: true, title: true } },
    ) as { findMany: (a?: unknown) => Promise<unknown> };

    await guarded.findMany();

    expect(delegates.calls.map((c) => c.delegate)).toEqual(["project"]);
  });

  it("gives the operation to the selected delegate only", async () => {
    const ext = makeGuard().extension(() => ({}));
    const delegates = makeDelegates();

    const guarded = guardOn(
      ext,
      { $name: "User", $parent: delegates },
      { select: { email: true, id: true } },
    ) as { findMany: (a?: unknown) => Promise<unknown> };

    await guarded.findMany();

    // Not just "user was called": the other delegate must be untouched, which is
    // what a stale or mis-resolved key would break.
    expect(delegates.calls).toHaveLength(1);
    expect(delegates.calls[0]?.delegate).toBe("user");
  });

  it("throws ShapeError when the model name is missing", () => {
    const ext = makeGuard().extension(() => ({}));
    const delegates = makeDelegates();

    expect(() =>
      guardOn(ext, { $parent: delegates }, { select: { id: true } }),
    ).toThrow(ShapeError);
  });

  it("throws ShapeError when the model name is unknown", () => {
    const ext = makeGuard().extension(() => ({}));
    const delegates = makeDelegates();

    expect(() =>
      guardOn(
        ext,
        { $name: "NotAModel", $parent: delegates },
        { select: { id: true } },
      ),
    ).toThrow(ShapeError);
  });
});
