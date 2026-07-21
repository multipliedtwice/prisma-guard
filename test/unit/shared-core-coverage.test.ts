import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ALL_RELATION_OPS,
  COMBINATOR_KEYS,
  force,
  GUARD_SHAPE_KEYS,
  isForcedValue,
  isUnsupportedMarker,
  SHAPE_CONFIG_KEYS,
  TO_MANY_RELATION_OPS,
  TO_ONE_RELATION_OPS,
  toDelegateKey,
  unsupported,
} from "../../src/shared/constants.js";
import { deepClone } from "../../src/shared/deep-clone.js";
import { deepEqual } from "../../src/shared/deep-equal.js";
import {
  getAllowedBodyKeys,
  getAllowedShapeKeys,
  methodSupportsProjection,
} from "../../src/shared/operation-shape-keys.js";
import {
  coerceToArray,
  isObjectLike,
  isPlainObject,
  isZodSchema,
  schemaProducesValueForUndefined,
} from "../../src/shared/utils.js";

describe("shared constants", () => {
  it("exposes the expected key and relation sets", () => {
    expect(SHAPE_CONFIG_KEYS.has("where")).toBe(true);
    expect(GUARD_SHAPE_KEYS.has("data")).toBe(true);
    expect(COMBINATOR_KEYS).toEqual(new Set(["AND", "OR", "NOT"]));
    expect(TO_MANY_RELATION_OPS.has("some")).toBe(true);
    expect(TO_ONE_RELATION_OPS.has("isNot")).toBe(true);
    expect(ALL_RELATION_OPS).toEqual(
      new Set(["some", "every", "none", "is", "isNot"]),
    );
  });

  it("converts model names to delegate keys", () => {
    expect(toDelegateKey("UserProfile")).toBe("userProfile");
    expect(toDelegateKey("A")).toBe("a");
  });

  it("creates and detects forced values", () => {
    const value = force(null);
    expect(value.value).toBeNull();
    expect(isForcedValue(value)).toBe(true);
    expect(isForcedValue({ value: null })).toBe(false);
    expect(isForcedValue(null)).toBe(false);
    expect(isForcedValue("value")).toBe(false);
  });

  it("creates and detects unsupported markers", () => {
    const value = unsupported();
    expect(isUnsupportedMarker(value)).toBe(true);
    expect(isUnsupportedMarker({})).toBe(false);
    expect(isUnsupportedMarker(null)).toBe(false);
  });
});

describe("deepClone", () => {
  it("returns primitive values unchanged", () => {
    expect(deepClone(null)).toBeNull();
    expect(deepClone(undefined)).toBeUndefined();
    expect(deepClone("text")).toBe("text");
    expect(deepClone(42)).toBe(42);
    expect(deepClone(true)).toBe(true);
    expect(deepClone(10n)).toBe(10n);
  });

  it("clones supported object types", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const bytes = new Uint8Array([1, 2, 3]);
    const regex = /value/gi;
    const input = {
      date,
      bytes,
      regex,
      array: [{ nested: "value" }],
    };

    const result = deepClone(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.date).not.toBe(date);
    expect(result.bytes).not.toBe(bytes);
    expect(result.regex).not.toBe(regex);
    expect(result.array).not.toBe(input.array);
    expect(result.array[0]).not.toBe(input.array[0]);
  });

  it("clones null-prototype records into independent records", () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.value = { nested: true };

    const result = deepClone(input);

    expect(result).toEqual({ value: { nested: true } });
    expect(result).not.toBe(input);
    expect(result.value).not.toBe(input.value);
  });

  it("preserves class instances and unsupported primitive types", () => {
    class Box {
      constructor(readonly value: string) {}
    }

    const box = new Box("x");
    const fn = () => "value";
    const symbol = Symbol("value");

    expect(deepClone(box)).toBe(box);
    expect(deepClone(fn)).toBe(fn);
    expect(deepClone(symbol)).toBe(symbol);
  });
});

describe("deepEqual", () => {
  it("handles identity, null, undefined, primitive, and bigint values", () => {
    const object = { value: true };
    expect(deepEqual(object, object)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(undefined, null)).toBe(false);
    expect(deepEqual(undefined, 1)).toBe(false);
    expect(deepEqual("1", 1)).toBe(false);
    expect(deepEqual(1n, 1n)).toBe(true);
    expect(deepEqual(1n, 2n)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
  });

  it("compares dates and regular expressions", () => {
    expect(
      deepEqual(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      deepEqual(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-02T00:00:00.000Z"),
      ),
    ).toBe(false);
    expect(deepEqual(new Date(), {})).toBe(false);
    expect(deepEqual(/value/gi, /value/gi)).toBe(true);
    expect(deepEqual(/value/g, /value/i)).toBe(false);
    expect(deepEqual(/value/g, {})).toBe(false);
  });

  it("compares arrays recursively", () => {
    expect(deepEqual([1, { value: [true] }], [1, { value: [true] }])).toBe(
      true,
    );
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual({ 0: 1 }, [1])).toBe(false);
    expect(deepEqual([1], [1, 2])).toBe(false);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
  });

  it("compares plain and null-prototype objects recursively", () => {
    const left = Object.create(null) as Record<string, unknown>;
    const right = Object.create(null) as Record<string, unknown>;
    left.value = { nested: 1 };
    right.value = { nested: 1 };

    expect(deepEqual(left, right)).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("rejects non-plain object instances", () => {
    class Box {
      constructor(readonly value: string) {}
    }

    expect(deepEqual(new Box("x"), new Box("x"))).toBe(false);
    expect(deepEqual(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(false);
  });
});

describe("shared utils", () => {
  it("distinguishes plain and object-like values", () => {
    const nullPrototype = Object.create(null);
    class Box {}

    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(nullPrototype)).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Box())).toBe(false);

    expect(isObjectLike({})).toBe(true);
    expect(isObjectLike(new Date())).toBe(true);
    expect(isObjectLike(new Box())).toBe(true);
    expect(isObjectLike([])).toBe(false);
    expect(isObjectLike(null)).toBe(false);
    expect(isObjectLike("value")).toBe(false);
  });

  it("detects schemas that produce defaults for undefined", () => {
    expect(schemaProducesValueForUndefined(z.string().default("default"))).toBe(
      true,
    );
    expect(schemaProducesValueForUndefined(z.string().optional())).toBe(false);
    expect(schemaProducesValueForUndefined(z.string())).toBe(false);
  });

  it("detects Zod schemas structurally", () => {
    expect(isZodSchema(z.string())).toBe(true);
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema("schema")).toBe(false);
    expect(isZodSchema({ parse() {} })).toBe(false);
    expect(isZodSchema({ optional() {} })).toBe(false);
  });

  it("preserves values that are not contiguous numeric-key objects", () => {
    const array = ["a"];
    const empty = {};
    const named = { value: "a" };
    const nonCanonical = { "00": "a" };
    const sparse = { "0": "a", "2": "c" };

    expect(coerceToArray(array)).toBe(array);
    expect(coerceToArray(null)).toBeNull();
    expect(coerceToArray(undefined)).toBeUndefined();
    expect(coerceToArray("value")).toBe("value");
    expect(coerceToArray(empty)).toBe(empty);
    expect(coerceToArray(named)).toBe(named);
    expect(coerceToArray(nonCanonical)).toBe(nonCanonical);
    expect(coerceToArray(sparse)).toBe(sparse);
  });

  it("converts contiguous numeric-key objects to arrays", () => {
    expect(coerceToArray({ "1": "b", "0": "a", "2": "c" })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("operation shape keys", () => {
  it("returns and caches allowed body keys", () => {
    const first = getAllowedBodyKeys("update", true);
    const second = getAllowedBodyKeys("update", true);

    expect(first).toBe(second);
    expect(first).toEqual(new Set(["data", "where", "select", "include"]));
    expect(getAllowedBodyKeys("createMany", true)).toEqual(
      new Set(["data", "skipDuplicates"]),
    );
  });

  it("returns and caches allowed shape keys", () => {
    const first = getAllowedShapeKeys("delete", true);
    const second = getAllowedShapeKeys("delete", true);

    expect(first).toBe(second);
    expect(first).toEqual(new Set(["where", "select", "include"]));
    expect(getAllowedShapeKeys("updateMany", true)).toEqual(
      new Set(["data", "where"]),
    );
  });

  it("rejects unknown mutation methods", () => {
    expect(() => getAllowedBodyKeys("unknown", false)).toThrow(
      'Unknown mutation method "unknown"',
    );
    expect(() => getAllowedShapeKeys("unknown", false)).toThrow(
      'Unknown mutation method "unknown"',
    );
  });

  it("reports projection support", () => {
    expect(methodSupportsProjection("create")).toBe(true);
    expect(methodSupportsProjection("createMany")).toBe(false);
    expect(methodSupportsProjection("unknown")).toBe(false);
  });
});
