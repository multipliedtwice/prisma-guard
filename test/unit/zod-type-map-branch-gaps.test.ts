import { describe, it, expect } from "vitest";
import type { FieldMeta, EnumMap } from "../../src/shared/types.js";
import { ShapeError } from "../../src/shared/errors.js";
import {
  createOperatorSchema,
  createBaseType,
} from "../../src/runtime/zod-type-map.js";
import { createScalarBase } from "../../src/shared/scalar-base.js";

const scalarBase = createScalarBase(false);

const enumMap: EnumMap = {
  Role: ["ADMIN", "USER"],
};

const emptyEnumMap: EnumMap = {};

const enumMapEmpty: EnumMap = {
  EmptyEnum: [],
};

function enumField(type = "Role"): FieldMeta {
  return {
    type,
    isList: false,
    isRequired: true,
    isId: false,
    isRelation: false,
    hasDefault: false,
    isUpdatedAt: false,
    isEnum: true,
  };
}

function scalarField(type: string): FieldMeta {
  return {
    type,
    isList: false,
    isRequired: true,
    isId: false,
    isRelation: false,
    hasDefault: false,
    isUpdatedAt: false,
  };
}

describe("zod-type-map branch gaps", () => {
  describe("createOperatorSchema: unknown enum in enumMap", () => {
    it("throws ShapeError when enum type not in enumMap", () => {
      expect(() =>
        createOperatorSchema(
          enumField("NonExistent"),
          "equals",
          emptyEnumMap,
          scalarBase,
        ),
      ).toThrow(ShapeError);
    });

    it("throws ShapeError when enum has empty values array", () => {
      expect(() =>
        createOperatorSchema(
          enumField("EmptyEnum"),
          "equals",
          enumMapEmpty,
          scalarBase,
        ),
      ).toThrow(ShapeError);
    });
  });

  describe("createOperatorSchema: unsupported operator for enum", () => {
    it("throws ShapeError for gt on enum field", () => {
      expect(() =>
        createOperatorSchema(enumField(), "gt", enumMap, scalarBase),
      ).toThrow(ShapeError);
    });

    it("throws ShapeError for lt on enum field", () => {
      expect(() =>
        createOperatorSchema(enumField(), "lt", enumMap, scalarBase),
      ).toThrow(ShapeError);
    });

    it("throws ShapeError for contains on enum field", () => {
      expect(() =>
        createOperatorSchema(enumField(), "contains", enumMap, scalarBase),
      ).toThrow(ShapeError);
    });
  });

  describe("createOperatorSchema: unknown scalar type", () => {
    it("throws ShapeError for unknown scalar type", () => {
      expect(() =>
        createOperatorSchema(
          scalarField("CustomType"),
          "equals",
          enumMap,
          scalarBase,
        ),
      ).toThrow(ShapeError);
    });

    it("creates valid schema for Json type in operator schema", () => {
      const schema = createOperatorSchema(
        scalarField("Json"),
        "equals",
        enumMap,
        scalarBase,
      );
      const result = schema.parse({ key: "value" });
      expect(result).toEqual({ key: "value" });
    });
  });

  describe("createOperatorSchema: unsupported operator for scalar", () => {
    it("throws ShapeError for contains on Int", () => {
      expect(() =>
        createOperatorSchema(
          scalarField("Int"),
          "contains",
          enumMap,
          scalarBase,
        ),
      ).toThrow(ShapeError);
    });

    it("throws ShapeError for startsWith on Boolean", () => {
      expect(() =>
        createOperatorSchema(
          scalarField("Boolean"),
          "startsWith",
          enumMap,
          scalarBase,
        ),
      ).toThrow(ShapeError);
    });
  });

  describe("createBaseType: unknown scalar type", () => {
    it("throws ShapeError for unknown scalar type", () => {
      expect(() =>
        createBaseType(scalarField("Unknown"), emptyEnumMap, scalarBase),
      ).toThrow(ShapeError);
    });
  });

  describe("createBaseType: unknown enum", () => {
    it("throws ShapeError when enum not in map", () => {
      expect(() =>
        createBaseType(enumField("Missing"), emptyEnumMap, scalarBase),
      ).toThrow(ShapeError);
    });
  });
});
