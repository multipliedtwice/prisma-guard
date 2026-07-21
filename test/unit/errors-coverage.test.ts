import { describe, expect, it } from "vitest";
import {
  CallerError,
  formatZodError,
  PolicyError,
  ShapeError,
  toShapeError,
  wrapParseError,
  wrapZod,
} from "../../src/shared/errors.js";

function format(issue: Record<string, unknown>): string {
  return formatZodError({ issues: [issue] } as any);
}

describe("guard errors", () => {
  it("sets stable names, status codes, error codes, and causes", () => {
    const cause = new Error("cause");
    const policy = new PolicyError(undefined, { cause });
    const shape = new ShapeError("invalid", { cause });
    const caller = new CallerError("unknown", { cause });

    expect(policy).toMatchObject({
      name: "PolicyError",
      message: "Access denied",
      status: 403,
      code: "POLICY_DENIED",
      cause,
    });
    expect(shape).toMatchObject({
      name: "ShapeError",
      message: "invalid",
      status: 400,
      code: "SHAPE_INVALID",
      cause,
    });
    expect(caller).toMatchObject({
      name: "CallerError",
      message: "unknown",
      status: 400,
      code: "CALLER_UNKNOWN",
      cause,
    });
  });
});

describe("formatZodError", () => {
  it("formats invalid union branches from errors", () => {
    expect(
      format({
        code: "invalid_union",
        path: ["value"],
        message: "Invalid input",
        errors: [
          [
            {
              code: "invalid_type",
              path: [],
              expected: "string",
              received: "number",
              message: "Invalid input",
            },
          ],
          [
            {
              code: "invalid_value",
              path: [],
              values: ["A", "B"],
              message: "Invalid input",
            },
          ],
        ],
      }),
    ).toBe(
      "value: No matching variant (branch 1: [Expected string, received number] | branch 2: [Invalid value. Expected one of: A, B])",
    );
  });

  it("formats invalid union branches from unionErrors", () => {
    expect(
      format({
        code: "invalid_union",
        path: [],
        message: "Invalid input",
        unionErrors: [
          {
            issues: [
              {
                code: "invalid_type",
                path: ["id"],
                expected: "string",
                message: "Invalid input",
              },
            ],
          },
        ],
      }),
    ).toBe(
      "No matching variant (branch 1: [id: Expected string])",
    );
  });

  it("formats invalid unions without branch details", () => {
    expect(
      format({
        code: "invalid_union",
        path: [],
        message: "Invalid input",
      }),
    ).toBe("No matching variant");
  });

  it("formats unrecognized keys", () => {
    expect(
      format({
        code: "unrecognized_keys",
        path: ["where"],
        keys: ["extra", "other"],
        message: "Unrecognized keys",
      }),
    ).toBe("where: Unrecognized key(s): extra, other");
    expect(
      format({
        code: "unrecognized_keys",
        path: [],
        keys: [],
        message: "Unrecognized keys",
      }),
    ).toBe("Unrecognized keys");
  });

  it("formats invalid types", () => {
    expect(
      format({
        code: "invalid_type",
        path: ["id"],
        expected: "string",
        received: "number",
        message: "Invalid input",
      }),
    ).toBe("id: Expected string, received number");
    expect(
      format({
        code: "invalid_type",
        path: [],
        expected: "string",
        message: "Invalid input",
      }),
    ).toBe("Expected string");
    expect(
      format({
        code: "invalid_type",
        path: [],
        message: "Invalid input",
      }),
    ).toBe("Invalid input");
  });

  it("formats enum and literal value errors", () => {
    expect(
      format({
        code: "invalid_enum_value",
        path: ["role"],
        options: ["ADMIN", "USER"],
        message: "Invalid enum",
      }),
    ).toBe("role: Invalid value. Expected one of: ADMIN, USER");
    expect(
      format({
        code: "invalid_value",
        path: [],
        values: [true],
        message: "Invalid literal",
      }),
    ).toBe("Invalid value. Expected one of: true");
  });

  it("formats lower bounds", () => {
    expect(
      format({
        code: "too_small",
        path: [],
        origin: "string",
        minimum: 2,
        message: "Too small",
      }),
    ).toBe("String must contain at least 2 character(s)");
    expect(
      format({
        code: "too_small",
        path: [],
        type: "array",
        minimum: 1,
        message: "Too small",
      }),
    ).toBe("Array must contain at least 1 element(s)");
    expect(
      format({
        code: "too_small",
        path: [],
        origin: "number",
        minimum: 0,
        message: "Too small",
      }),
    ).toBe("Number must be >= 0");
    expect(
      format({
        code: "too_small",
        path: [],
        origin: "date",
        minimum: 0,
        message: "Too small",
      }),
    ).toBe("Too small");
  });

  it("formats upper bounds", () => {
    expect(
      format({
        code: "too_big",
        path: [],
        origin: "string",
        maximum: 5,
        message: "Too big",
      }),
    ).toBe("String must contain at most 5 character(s)");
    expect(
      format({
        code: "too_big",
        path: [],
        type: "array",
        maximum: 3,
        message: "Too big",
      }),
    ).toBe("Array must contain at most 3 element(s)");
    expect(
      format({
        code: "too_big",
        path: [],
        origin: "number",
        maximum: 10,
        message: "Too big",
      }),
    ).toBe("Number must be <= 10");
    expect(
      format({
        code: "too_big",
        path: [],
        origin: "date",
        maximum: 10,
        message: "Too big",
      }),
    ).toBe("Too big");
  });

  it("formats invalid formats and generic issues", () => {
    expect(
      format({
        code: "invalid_format",
        path: ["email"],
        format: "email",
        message: "Invalid format",
      }),
    ).toBe("email: Invalid email format");
    expect(
      format({
        code: "custom",
        path: ["data", 0, "name"],
        message: "Custom failure",
      }),
    ).toBe("data.0.name: Custom failure");
  });

  it("joins multiple issues", () => {
    expect(
      formatZodError({
        issues: [
          { code: "custom", path: ["a"], message: "first" },
          { code: "custom", path: ["b"], message: "second" },
        ],
      } as any),
    ).toBe("a: first; b: second");
  });
});

describe("error wrapping", () => {
  it("wraps ShapeError with context and preserves the cause", () => {
    const original = new ShapeError("invalid shape");

    expect(() => wrapZod(original, "Create failed")).toThrowError(
      "Create failed: invalid shape",
    );

    try {
      wrapZod(original, "Create failed");
    } catch (error) {
      expect(error).toBeInstanceOf(ShapeError);
      expect((error as Error).cause).toBe(original);
    }
  });

  it("wraps Zod-like errors with formatted context", () => {
    const original = {
      issues: [
        {
          code: "invalid_type",
          path: ["id"],
          expected: "string",
          received: "number",
          message: "Invalid input",
        },
      ],
    };

    expect(() => wrapZod(original, "Update failed")).toThrowError(
      "Update failed: id: Expected string, received number",
    );
  });

  it("rethrows unrelated errors unchanged", () => {
    const original = new Error("database failed");

    try {
      wrapZod(original, "ignored");
    } catch (error) {
      expect(error).toBe(original);
    }
  });

  it("delegates parse error wrapping", () => {
    const original = new ShapeError("invalid");

    expect(() => wrapParseError(original, "Parse failed")).toThrowError(
      "Parse failed: invalid",
    );
  });

  it("converts Zod-like errors to ShapeError", () => {
    const original = {
      issues: [{ code: "custom", path: [], message: "invalid" }],
    };
    const result = toShapeError(original, "Guard failed");

    expect(result).toBeInstanceOf(ShapeError);
    expect(result.message).toBe("Guard failed: invalid");
    expect(result.cause).toBe(original);
  });

  it("returns unrelated errors unchanged", () => {
    const original = new Error("failure");

    expect(toShapeError(original)).toBe(original);
  });
});
