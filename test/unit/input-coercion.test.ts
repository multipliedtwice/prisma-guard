import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  wrapWithInputCoercion,
  createScalarBase,
} from "../../src/shared/scalar-base.js";

const scalarBase = createScalarBase(false);

function coerce(fieldType: string, isList: boolean = false) {
  let base = scalarBase[fieldType]!();
  if (isList) {
    base = z.array(base);
  }
  return wrapWithInputCoercion(fieldType, isList, base);
}

describe("wrapWithInputCoercion", () => {
  describe("String coercion", () => {
    const schema = coerce("String");

    it("accepts string values", () => {
      expect(schema.parse("hello")).toBe("hello");
      expect(schema.parse("")).toBe("");
      expect(schema.parse("  spaces  ")).toBe("  spaces  ");
    });

    it("coerces number to string", () => {
      expect(schema.parse(123)).toBe("123");
      expect(schema.parse(0)).toBe("0");
      expect(schema.parse(-42)).toBe("-42");
      expect(schema.parse(3.14)).toBe("3.14");
      expect(schema.parse(1e10)).toBe("10000000000");
      expect(schema.parse(-0)).toBe("0");
    });

    it("rejects non-string non-number values", () => {
      expect(() => schema.parse(true)).toThrow();
      expect(() => schema.parse(null)).toThrow();
      expect(() => schema.parse(undefined)).toThrow();
      expect(() => schema.parse({})).toThrow();
      expect(() => schema.parse([])).toThrow();
      expect(() => schema.parse(Symbol("x"))).toThrow();
    });

    it("rejects NaN and Infinity as number inputs", () => {
      expect(() => schema.parse(NaN)).toThrow();
      expect(() => schema.parse(Infinity)).toThrow();
      expect(() => schema.parse(-Infinity)).toThrow();
    });
  });

  describe("String coercion with list", () => {
    const schema = coerce("String", true);

    it("accepts string arrays", () => {
      expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
    });

    it("coerces number arrays to string arrays", () => {
      expect(schema.parse([1, 2, 3])).toEqual(["1", "2", "3"]);
    });

    it("coerces mixed arrays", () => {
      expect(schema.parse(["hello", 42])).toEqual(["hello", "42"]);
    });

    it("rejects non-array", () => {
      expect(() => schema.parse("hello")).toThrow();
      expect(() => schema.parse(123)).toThrow();
    });
  });

  describe("Int coercion", () => {
    const schema = coerce("Int");

    it("accepts integer numbers", () => {
      expect(schema.parse(42)).toBe(42);
      expect(schema.parse(0)).toBe(0);
      expect(schema.parse(-10)).toBe(-10);
    });

    it("rejects non-integer numbers", () => {
      expect(() => schema.parse(3.14)).toThrow();
      expect(() => schema.parse(0.1)).toThrow();
    });

    it("coerces valid integer strings to number", () => {
      expect(schema.parse("42")).toBe(42);
      expect(schema.parse("0")).toBe(0);
      expect(schema.parse("-10")).toBe(-10);
      expect(schema.parse("999999")).toBe(999999);
    });

    it("rejects non-integer strings", () => {
      expect(() => schema.parse("3.14")).toThrow();
      expect(() => schema.parse("abc")).toThrow();
      expect(() => schema.parse("")).toThrow();
      expect(() => schema.parse("12abc")).toThrow();
      expect(() => schema.parse("1e3")).toThrow();
      expect(() => schema.parse("0x10")).toThrow();
    });

    it("rejects strings with leading/trailing spaces", () => {
      expect(() => schema.parse(" 42")).toThrow();
      expect(() => schema.parse("42 ")).toThrow();
    });

    it("rejects non-string non-number values", () => {
      expect(() => schema.parse(true)).toThrow();
      expect(() => schema.parse(null)).toThrow();
      expect(() => schema.parse(undefined)).toThrow();
      expect(() => schema.parse({})).toThrow();
      expect(() => schema.parse([])).toThrow();
    });

    it("rejects NaN and Infinity", () => {
      expect(() => schema.parse(NaN)).toThrow();
      expect(() => schema.parse(Infinity)).toThrow();
    });
  });

  describe("Int coercion with list", () => {
    const schema = coerce("Int", true);

    it("accepts integer number arrays", () => {
      expect(schema.parse([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it("coerces string arrays to integer arrays", () => {
      expect(schema.parse(["1", "2", "3"])).toEqual([1, 2, 3]);
    });

    it("coerces mixed arrays", () => {
      expect(schema.parse([1, "2", 3])).toEqual([1, 2, 3]);
    });

    it("rejects arrays with non-integer values", () => {
      expect(() => schema.parse([1, "3.14"])).toThrow();
      expect(() => schema.parse([1, "abc"])).toThrow();
    });
  });

  describe("Float coercion", () => {
    const schema = coerce("Float");

    it("accepts number values", () => {
      expect(schema.parse(3.14)).toBe(3.14);
      expect(schema.parse(42)).toBe(42);
      expect(schema.parse(0)).toBe(0);
      expect(schema.parse(-2.5)).toBe(-2.5);
    });

    it("coerces valid float strings to number", () => {
      expect(schema.parse("3.14")).toBe(3.14);
      expect(schema.parse("42")).toBe(42);
      expect(schema.parse("0")).toBe(0);
      expect(schema.parse("-2.5")).toBe(-2.5);
      expect(schema.parse(".5")).toBe(0.5);
      expect(schema.parse("-.5")).toBe(-0.5);
    });

    it("coerces scientific notation strings", () => {
      expect(schema.parse("1e3")).toBe(1000);
      expect(schema.parse("1E3")).toBe(1000);
      expect(schema.parse("1.5e2")).toBe(150);
      expect(schema.parse("1e+3")).toBe(1000);
      expect(schema.parse("1e-3")).toBe(0.001);
      expect(schema.parse("-1.5e2")).toBe(-150);
    });

    it("rejects invalid float strings", () => {
      expect(() => schema.parse("abc")).toThrow();
      expect(() => schema.parse("")).toThrow();
      expect(() => schema.parse("12abc")).toThrow();
      expect(() => schema.parse("0x10")).toThrow();
      expect(() => schema.parse(".")).toThrow();
      expect(() => schema.parse("-.")).toThrow();
      expect(() => schema.parse("e3")).toThrow();
      expect(() => schema.parse("1e")).toThrow();
    });

    it("rejects strings with leading/trailing spaces", () => {
      expect(() => schema.parse(" 3.14")).toThrow();
      expect(() => schema.parse("3.14 ")).toThrow();
    });

    it("rejects non-string non-number values", () => {
      expect(() => schema.parse(true)).toThrow();
      expect(() => schema.parse(null)).toThrow();
      expect(() => schema.parse(undefined)).toThrow();
      expect(() => schema.parse({})).toThrow();
      expect(() => schema.parse([])).toThrow();
    });

    it("rejects NaN and Infinity numbers", () => {
      expect(() => schema.parse(NaN)).toThrow();
      expect(() => schema.parse(Infinity)).toThrow();
    });

    it("handles edge-case float strings", () => {
      expect(schema.parse("0.0")).toBe(0);
      expect(schema.parse("-0")).toBe(-0);
      expect(schema.parse("100.")).toBe(100);
      expect(schema.parse("000.5")).toBe(0.5);
    });
  });

  describe("Float coercion with list", () => {
    const schema = coerce("Float", true);

    it("accepts number arrays", () => {
      expect(schema.parse([1.1, 2.2, 3.3])).toEqual([1.1, 2.2, 3.3]);
    });

    it("coerces string arrays to float arrays", () => {
      expect(schema.parse(["1.1", "2.2"])).toEqual([1.1, 2.2]);
    });

    it("coerces mixed arrays", () => {
      expect(schema.parse([1.1, "2.2", 3])).toEqual([1.1, 2.2, 3]);
    });

    it("rejects arrays with invalid values", () => {
      expect(() => schema.parse([1.1, "abc"])).toThrow();
    });
  });

  describe("passthrough types (no coercion wrapping)", () => {
    describe("Decimal", () => {
      const schema = coerce("Decimal");

      it("accepts numbers", () => {
        expect(schema.parse(3.14)).toBe(3.14);
        expect(schema.parse(42)).toBe(42);
      });

      it("accepts valid decimal strings", () => {
        const result = schema.parse("3.14");
        expect(result).toBe("3.14");
      });

      it("accepts Decimal-like objects", () => {
        const decimalObj = { toFixed: () => "3.14", toNumber: () => 3.14 };
        expect(schema.parse(decimalObj)).toBe(decimalObj);
      });

      it("rejects invalid strings", () => {
        expect(() => schema.parse("abc")).toThrow();
        expect(() => schema.parse("")).toThrow();
      });

      it("rejects boolean", () => {
        expect(() => schema.parse(true)).toThrow();
      });
    });

    describe("BigInt", () => {
      const schema = coerce("BigInt");

      it("accepts bigint values", () => {
        expect(schema.parse(10n)).toBe(10n);
        expect(schema.parse(0n)).toBe(0n);
        expect(schema.parse(-5n)).toBe(-5n);
      });

      it("accepts safe integer numbers and transforms to bigint", () => {
        expect(schema.parse(42)).toBe(42n);
        expect(schema.parse(0)).toBe(0n);
        expect(schema.parse(-10)).toBe(-10n);
      });

      it("rejects non-integer numbers", () => {
        expect(() => schema.parse(3.14)).toThrow();
      });

      it("rejects unsafe integer numbers", () => {
        expect(() => schema.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow();
        expect(() => schema.parse(Number.MIN_SAFE_INTEGER - 1)).toThrow();
      });

      it("accepts valid integer strings and transforms to bigint", () => {
        expect(schema.parse("42")).toBe(42n);
        expect(schema.parse("-10")).toBe(-10n);
        expect(schema.parse("0")).toBe(0n);
      });

      it("rejects invalid strings", () => {
        expect(() => schema.parse("abc")).toThrow();
        expect(() => schema.parse("3.14")).toThrow();
        expect(() => schema.parse("")).toThrow();
      });

      it("rejects non-bigint non-number non-string values", () => {
        expect(() => schema.parse(true)).toThrow();
        expect(() => schema.parse(null)).toThrow();
        expect(() => schema.parse({})).toThrow();
      });
    });

    describe("Boolean", () => {
      const schema = coerce("Boolean");

      it("accepts boolean values", () => {
        expect(schema.parse(true)).toBe(true);
        expect(schema.parse(false)).toBe(false);
      });

      it("rejects non-boolean values", () => {
        expect(() => schema.parse(0)).toThrow();
        expect(() => schema.parse(1)).toThrow();
        expect(() => schema.parse("true")).toThrow();
        expect(() => schema.parse("false")).toThrow();
        expect(() => schema.parse(null)).toThrow();
        expect(() => schema.parse(undefined)).toThrow();
      });
    });

    describe("DateTime", () => {
      const schema = coerce("DateTime");

      it("accepts Date objects", () => {
        const date = new Date("2024-01-01T00:00:00Z");
        const result = schema.parse(date) as Date;
        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      });

      it("accepts ISO datetime strings with offset", () => {
        const result = schema.parse("2024-01-01T00:00:00+00:00");
        expect(result).toBeInstanceOf(Date);
      });

      it("accepts ISO datetime strings with Z", () => {
        const result = schema.parse("2024-01-01T12:30:00Z");
        expect(result).toBeInstanceOf(Date);
      });

      it("rejects non-datetime strings", () => {
        expect(() => schema.parse("not-a-date")).toThrow();
        expect(() => schema.parse("")).toThrow();
      });

      it("rejects non-date non-string values", () => {
        expect(() => schema.parse(123)).toThrow();
        expect(() => schema.parse(true)).toThrow();
        expect(() => schema.parse(null)).toThrow();
      });
    });

    describe("Json", () => {
      const schema = coerce("Json");

      it("accepts JSON-serializable values", () => {
        expect(schema.parse("hello")).toBe("hello");
        expect(schema.parse(42)).toBe(42);
        expect(schema.parse(true)).toBe(true);
        expect(schema.parse(null)).toBe(null);
        expect(schema.parse({ a: 1 })).toEqual({ a: 1 });
        expect(schema.parse([1, 2, 3])).toEqual([1, 2, 3]);
      });

      it("rejects non-JSON-serializable values", () => {
        expect(() => schema.parse(undefined)).toThrow();
        expect(() => schema.parse(() => {})).toThrow();
        expect(() => schema.parse(Symbol("x"))).toThrow();
      });
    });

    describe("Bytes", () => {
      const schema = coerce("Bytes");

      it("accepts strings", () => {
        expect(schema.parse("binary-data")).toBe("binary-data");
      });

      it("accepts Uint8Array", () => {
        const buf = new Uint8Array([1, 2, 3]);
        expect(schema.parse(buf)).toBe(buf);
      });

      it("accepts Uint8Array subclass", () => {
        const buf = new Uint8Array([1, 2, 3]);
        expect(schema.parse(buf)).toBe(buf);
      });

      it("rejects non-string non-Uint8Array values", () => {
        expect(() => schema.parse(123)).toThrow();
        expect(() => schema.parse(true)).toThrow();
        expect(() => schema.parse(null)).toThrow();
        expect(() => schema.parse({})).toThrow();
      });
    });
  });

  describe("unknown type falls through", () => {
    it("returns schema unchanged for unknown field type", () => {
      const base = z.string();
      const result = wrapWithInputCoercion("UnknownType", false, base);
      expect(result).toBe(base);
    });

    it("returns schema unchanged for enum-like types", () => {
      const base = z.enum(["A", "B"]);
      const result = wrapWithInputCoercion("SomeEnum", false, base);
      expect(result).toBe(base);
    });
  });

  describe("coercion piped through chained schemas", () => {
    it("String coercion pipes through .min() chain", () => {
      const chained = z.string().min(3);
      const schema = wrapWithInputCoercion("String", false, chained);
      expect(schema.parse("hello")).toBe("hello");
      expect(schema.parse(12345)).toBe("12345");
      expect(() => schema.parse(1)).toThrow();
      expect(() => schema.parse("ab")).toThrow();
    });

    it("String coercion pipes through .email() chain", () => {
      const chained = z.string().email();
      const schema = wrapWithInputCoercion("String", false, chained);
      expect(schema.parse("test@example.com")).toBe("test@example.com");
      expect(() => schema.parse(123)).toThrow();
      expect(() => schema.parse("not-email")).toThrow();
    });

    it("Int coercion pipes through .min() chain", () => {
      const chained = z.number().int().min(10);
      const schema = wrapWithInputCoercion("Int", false, chained);
      expect(schema.parse(42)).toBe(42);
      expect(schema.parse("42")).toBe(42);
      expect(() => schema.parse(5)).toThrow();
      expect(() => schema.parse("5")).toThrow();
    });

    it("Float coercion pipes through .min().max() chain", () => {
      const chained = z.number().min(0).max(100);
      const schema = wrapWithInputCoercion("Float", false, chained);
      expect(schema.parse(50)).toBe(50);
      expect(schema.parse("50.5")).toBe(50.5);
      expect(() => schema.parse(101)).toThrow();
      expect(() => schema.parse("101")).toThrow();
      expect(() => schema.parse(-1)).toThrow();
      expect(() => schema.parse("-1")).toThrow();
    });
  });

  describe("strict decimal mode", () => {
    const strictBase = createScalarBase(true);

    it("rejects numbers in strict mode", () => {
      const schema = strictBase.Decimal();
      expect(() => schema.parse(3.14)).toThrow();
    });

    it("accepts strings in strict mode", () => {
      const schema = strictBase.Decimal();
      expect(schema.parse("3.14")).toBe("3.14");
    });

    it("accepts Decimal-like objects in strict mode", () => {
      const schema = strictBase.Decimal();
      const decimalObj = { toFixed: () => "3.14", toNumber: () => 3.14 };
      expect(schema.parse(decimalObj)).toBe(decimalObj);
    });
  });
});
