import { z } from "zod";

export type ScalarBaseMap = Record<string, () => z.ZodTypeAny>;

function isJsonSafe(value: unknown): boolean {
  type Entry = { tag: "visit"; value: unknown } | { tag: "exit"; ref: object };

  const stack: Entry[] = [{ tag: "visit", value }];
  const ancestors = new Set<object>();

  while (stack.length > 0) {
    const entry = stack.pop()!;

    if (entry.tag === "exit") {
      ancestors.delete(entry.ref);
      continue;
    }

    const current = entry.value;

    if (current === undefined) return false;
    if (current === null) continue;

    switch (typeof current) {
      case "string":
      case "boolean":
        continue;
      case "number":
        if (!Number.isFinite(current)) return false;
        continue;
      case "object": {
        if (ancestors.has(current)) return false;
        ancestors.add(current);
        stack.push({ tag: "exit", ref: current });
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            stack.push({ tag: "visit", value: current[i] });
          }
          continue;
        }
        const proto = Object.getPrototypeOf(current);
        if (proto !== Object.prototype && proto !== null) return false;
        const values = Object.values(current as Record<string, unknown>);
        for (let i = 0; i < values.length; i++) {
          stack.push({ tag: "visit", value: values[i] });
        }
        continue;
      }
      default:
        return false;
    }
  }

  return true;
}

const DECIMAL_REGEX = /^-?(\d+\.?\d*|\.\d+)([eE]-?\d+)?$/;

const decimalStringSchema = z
  .string()
  .refine((s) => DECIMAL_REGEX.test(s), "Invalid decimal string");

const decimalObjectSchema = z.custom<unknown>(
  (v) =>
    v !== null &&
    typeof v === "object" &&
    typeof (v as any).toFixed === "function" &&
    typeof (v as any).toNumber === "function",
  "Expected Decimal-compatible object",
);

function createDecimalFactory(strict: boolean): () => z.ZodTypeAny {
  if (strict) {
    return () => z.union([decimalStringSchema, decimalObjectSchema]);
  }
  return () => z.union([z.number(), decimalStringSchema, decimalObjectSchema]);
}

export function createScalarBase(strictDecimal: boolean): ScalarBaseMap {
  return {
    String: () => z.string(),
    Int: () => z.number().int(),
    Float: () => z.number(),
    Decimal: createDecimalFactory(strictDecimal),
    BigInt: () =>
      z.union([
        z.bigint(),
        z
          .number()
          .int()
          .refine(
            (v) => v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER,
            "Number exceeds safe integer range for BigInt conversion",
          )
          .transform((v) => BigInt(v)),
        z
          .string()
          .regex(/^-?\d+$/)
          .transform((v) => BigInt(v)),
      ]),
    Boolean: () => z.boolean(),
    DateTime: () =>
      z
        .union([
          z.date(),
          z.string().refine(
            (s) => !isNaN(Date.parse(s)),
            "Invalid date string",
          ),
        ])
        .pipe(z.coerce.date()),
    Json: () =>
      z
        .unknown()
        .refine(
          isJsonSafe,
          "Value must be JSON-serializable (no undefined, functions, symbols, class instances, NaN, Infinity, or circular references)",
        ),
    Bytes: () =>
      z.union([z.string(), z.custom<unknown>((v) => v instanceof Uint8Array)]),
  };
}

export const SCALAR_BASE: ScalarBaseMap = createScalarBase(false);

export function wrapWithInputCoercion(
  fieldType: string,
  isList: boolean,
  schema: z.ZodTypeAny,
): z.ZodTypeAny {
  let itemCoercion: z.ZodTypeAny | null = null;

  switch (fieldType) {
    case "String":
      itemCoercion = z.union([z.string(), z.number().transform(String)]);
      break;
    case "Int":
      itemCoercion = z.union([
        z.number().transform((v) => Math.trunc(v)).pipe(z.number().int()),
        z
          .string()
          .regex(/^-?\d+(\.\d+)?$/)
          .transform((v) => Math.trunc(Number(v))),
      ]);
      break;
    case "Float":
      itemCoercion = z.union([
        z.number(),
        z
          .string()
          .regex(/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/)
          .transform(Number),
      ]);
      break;
    default:
      return schema;
  }

  const coercion = isList ? z.array(itemCoercion) : itemCoercion;
  return coercion.pipe(schema);
}