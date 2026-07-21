import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ShapeError } from "../../src/shared/errors.js";
import {
  buildDefaultCountInput,
  buildDefaultIncludeInput,
  buildDefaultProjectionBody,
  buildDefaultProjectionInput,
  buildDefaultSelectInput,
  buildRelationArgsSkeleton,
} from "../../src/shared/projection-defaults.js";
import {
  assertAllowedKeys,
  buildLiteralTrueSchema,
  optionalOneOrMany,
  requireConfigTrue,
  requirePlainObjectConfig,
  singleOrArraySchema,
  strictObjectRequiringOne,
  wrapRelationOp,
} from "../../src/shared/zod-helpers.js";

describe("projection defaults", () => {
  it("builds scalar, relation, and count projection defaults", () => {
    const result = buildDefaultProjectionInput({
      id: true,
      tasks: {
        where: { active: { equals: true } },
        select: { id: true },
        include: { owner: true },
      },
      _count: {
        select: {
          tasks: true,
          members: false,
        },
      } as any,
    });

    expect(result).toEqual({
      id: true,
      tasks: {
        select: { id: true },
        include: { owner: true },
      },
      _count: {
        select: {
          tasks: true,
          members: true,
        },
      },
    });
  });

  it("uses the same implementation for select and include defaults", () => {
    const config = {
      id: true,
      tasks: { select: { id: true } },
    } as const;

    expect(buildDefaultSelectInput(config)).toEqual(
      buildDefaultProjectionInput(config),
    );
    expect(buildDefaultIncludeInput(config)).toEqual(
      buildDefaultProjectionInput(config),
    );
  });

  it("builds relation skeletons and ignores non-projection arguments", () => {
    expect(
      buildRelationArgsSkeleton({
        where: { active: { equals: true } },
        orderBy: { name: true },
        cursor: { id: true },
        take: 10,
        skip: true,
        select: { id: true },
        include: { owner: true },
      }),
    ).toEqual({
      select: { id: true },
      include: { owner: true },
    });

    expect(buildRelationArgsSkeleton({ where: { id: true } })).toEqual({});
  });

  it("builds count defaults", () => {
    expect(buildDefaultCountInput(true)).toBe(true);
    expect(buildDefaultCountInput({ select: { tasks: true, users: false } })).toEqual(
      {
        select: { tasks: true, users: true },
      },
    );
  });

  it("falls back to true for malformed count configurations", () => {
    expect(buildDefaultCountInput(null as any)).toBe(true);
    expect(buildDefaultCountInput({})).toBe(true);
    expect(buildDefaultCountInput({ select: null })).toBe(true);
    expect(buildDefaultCountInput({ select: [] })).toBe(true);
  });

  it("builds default projection bodies with select precedence", () => {
    expect(
      buildDefaultProjectionBody({
        select: { id: true },
        include: { tasks: true },
      }),
    ).toEqual({ select: { id: true } });

    expect(
      buildDefaultProjectionBody({
        include: { tasks: true },
      }),
    ).toEqual({ include: { tasks: true } });

    expect(buildDefaultProjectionBody({})).toEqual({});
  });
});

describe("zod helpers", () => {
  it("builds strict objects requiring at least one defined field", () => {
    const schema = strictObjectRequiringOne(
      {
        id: z.string().optional(),
        email: z.string().optional(),
      },
      "one field required",
    );

    expect(schema.parse({ id: "1" })).toEqual({ id: "1" });
    expect(() => schema.parse({})).toThrow("one field required");
    expect(() => schema.parse({ other: "value" })).toThrow();
  });

  it("accepts one value or a non-empty array", () => {
    const schema = singleOrArraySchema(z.string());

    expect(schema.parse("a")).toBe("a");
    expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(schema.parse({ "0": "a", "1": "b" })).toEqual(["a", "b"]);
    expect(() => schema.parse([])).toThrow();
    expect(() => schema.parse([1])).toThrow();
  });

  it("accepts optional one-or-many values including empty arrays", () => {
    const schema = optionalOneOrMany(z.string());

    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse("a")).toBe("a");
    expect(schema.parse([])).toEqual([]);
    expect(schema.parse({ "0": "a" })).toEqual(["a"]);
    expect(() => schema.parse([1])).toThrow();
  });

  it("wraps to-one and to-many relation operations", () => {
    const toOne = wrapRelationOp(false, z.object({ id: z.string() }));
    const toMany = wrapRelationOp(true, z.object({ id: z.string() }));

    expect(toOne.parse(undefined)).toBeUndefined();
    expect(toOne.parse({ id: "1" })).toEqual({ id: "1" });
    expect(() => toOne.parse([{ id: "1" }])).toThrow();

    expect(toMany.parse(undefined)).toBeUndefined();
    expect(toMany.parse({ id: "1" })).toEqual({ id: "1" });
    expect(toMany.parse([{ id: "1" }, { id: "2" }])).toEqual([
      { id: "1" },
      { id: "2" },
    ]);
  });

  it("builds optional literal-true objects and validates field names", () => {
    const validate = vi.fn();
    const schema = buildLiteralTrueSchema(
      ["id", "email"],
      "one projection required",
      validate,
    );

    expect(validate.mock.calls).toEqual([["id"], ["email"]]);
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse({ id: true })).toEqual({ id: true });
    expect(() => schema.parse({})).toThrow("one projection required");
    expect(() => schema.parse({ id: false })).toThrow();
    expect(() => schema.parse({ other: true })).toThrow();
  });

  it("requires every config value to be true", () => {
    expect(() => requireConfigTrue({}, "projection")).not.toThrow();
    expect(() =>
      requireConfigTrue({ id: true, email: true }, "projection"),
    ).not.toThrow();
    expect(() => requireConfigTrue({ id: false }, "projection")).toThrow(
      'Config value for "id" in projection must be true, got boolean',
    );
  });

  it("requires plain object configs", () => {
    const plain = { id: true };
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.id = true;

    expect(requirePlainObjectConfig(plain, "invalid")).toBe(plain);
    expect(requirePlainObjectConfig(nullPrototype, "invalid")).toBe(
      nullPrototype,
    );
    expect(() => requirePlainObjectConfig([], "invalid config")).toThrow(
      ShapeError,
    );
    expect(() => requirePlainObjectConfig(new Date(), "invalid config")).toThrow(
      "invalid config",
    );
  });

  it("asserts allowed keys", () => {
    expect(() =>
      assertAllowedKeys(
        { where: {}, select: {} },
        new Set(["where", "select"]),
        (key) => `unknown ${key}`,
      ),
    ).not.toThrow();

    expect(() =>
      assertAllowedKeys(
        { where: {}, extra: true },
        new Set(["where"]),
        (key) => `unknown ${key}`,
      ),
    ).toThrow("unknown extra");
  });
});
