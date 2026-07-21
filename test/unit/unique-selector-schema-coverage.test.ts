import { describe, expect, it } from "vitest";
import { buildDirectScalarSchema } from "../../src/runtime/direct-scalar-schema.js";
import { buildUniqueSelectorSchema } from "../../src/runtime/unique-selector-schema.js";
import { createScalarBase } from "../../src/shared/scalar-base.js";
import type {
  EnumMap,
  FieldMeta,
  TypeMap,
  UniqueMap,
} from "../../src/shared/types.js";

function field(
  type: string,
  overrides: Partial<FieldMeta> = {},
): FieldMeta {
  return {
    type,
    isList: false,
    isRequired: true,
    isId: false,
    isRelation: false,
    hasDefault: false,
    isUpdatedAt: false,
    ...overrides,
  };
}

const TYPE_MAP: TypeMap = {
  Parent: {
    id: field("String", { isId: true }),
    user: field("User", { isRelation: true }),
  },
  User: {
    id: field("String", { isId: true, isUnique: true }),
    externalId: field("String", {
      isRequired: false,
      isUnique: true,
    }),
    tenantId: field("String"),
    slug: field("String"),
    role: field("Role", { isEnum: true, isUnique: true }),
    relationKey: field("String", { isRelation: true }),
    unsupportedKey: field("Unsupported", {
      isUnsupported: true,
      isUnique: true,
    }),
  },
};

const UNIQUE_MAP: UniqueMap = {
  User: [
    { selector: "id", fields: ["id"] },
    { selector: "externalId", fields: ["externalId"] },
    {
      selector: "tenant_slug",
      fields: ["tenantId", "slug"],
    },
    { selector: "role", fields: ["role"] },
    { selector: "relationKey", fields: ["relationKey"] },
    { selector: "unsupportedKey", fields: ["unsupportedKey"] },
  ],
};

const ENUM_MAP: EnumMap = {
  Role: ["ADMIN", "USER"],
};

const scalarBase = createScalarBase(false);

function build(
  config: Record<string, unknown>,
  typeMap: TypeMap = TYPE_MAP,
  uniqueMap: UniqueMap = UNIQUE_MAP,
) {
  return buildUniqueSelectorSchema(
    "Parent",
    "user",
    "User",
    config,
    typeMap,
    uniqueMap,
    ENUM_MAP,
    scalarBase,
    "connect",
  );
}

describe("buildDirectScalarSchema", () => {
  it("applies scalar input coercion", () => {
    const schema = buildDirectScalarSchema(
      field("String"),
      ENUM_MAP,
      scalarBase,
    );

    expect(schema.parse(123)).toBe("123");
  });

  it("applies list input coercion", () => {
    const schema = buildDirectScalarSchema(
      field("String", { isList: true }),
      ENUM_MAP,
      scalarBase,
    );

    expect(schema.parse([1, "2"])).toEqual(["1", "2"]);
  });

  it("returns enum schemas without scalar coercion", () => {
    const schema = buildDirectScalarSchema(
      field("Role", { isEnum: true }),
      ENUM_MAP,
      scalarBase,
    );

    expect(schema.parse("ADMIN")).toBe("ADMIN");
    expect(() => schema.parse("OTHER")).toThrow();
  });

  it("returns unsupported schemas without scalar coercion", () => {
    const schema = buildDirectScalarSchema(
      field("Unsupported", { isUnsupported: true }),
      ENUM_MAP,
      scalarBase,
    );

    const value = Symbol("value");
    expect(schema.parse(value)).toBe(value);
  });

  it("does not apply scalar coercion to relation metadata", () => {
    const schema = buildDirectScalarSchema(
      field("String", { isRelation: true }),
      ENUM_MAP,
      scalarBase,
    );

    expect(schema.parse("value")).toBe("value");
    expect(() => schema.parse(123)).toThrow();
  });
});

describe("buildUniqueSelectorSchema validation", () => {
  it("rejects an unknown related model", () => {
    expect(() =>
      buildUniqueSelectorSchema(
        "Parent",
        "user",
        "Missing",
        { id: true },
        TYPE_MAP,
        UNIQUE_MAP,
        ENUM_MAP,
        scalarBase,
        "connect",
      ),
    ).toThrow('Unknown related model "Missing"');
  });

  it("rejects related models without unique constraints", () => {
    expect(() => build({ id: true }, TYPE_MAP, {})).toThrow(
      "requires related model \"User\" to have at least one unique constraint",
    );
  });

  it("rejects empty selector configs", () => {
    expect(() => build({})).toThrow(
      "must define at least one unique selector",
    );
  });

  it("rejects non-object compound selector configs", () => {
    expect(() => build({ tenant_slug: true })).toThrow(
      'Compound unique selector "tenant_slug"',
    );
  });

  it("rejects unknown compound selector fields", () => {
    expect(() =>
      build({
        tenant_slug: {
          tenantId: true,
          slug: true,
          extra: true,
        },
      }),
    ).toThrow('Unknown field "extra" in compound unique selector');
  });

  it("rejects missing compound selector fields", () => {
    expect(() =>
      build({
        tenant_slug: {
          tenantId: true,
        },
      }),
    ).toThrow('Missing field "slug"');
  });

  it("requires compound selector field configs to be true", () => {
    expect(() =>
      build({
        tenant_slug: {
          tenantId: true,
          slug: false,
        },
      }),
    ).toThrow('Field "slug" in compound unique selector');
  });

  it("rejects compound constraints containing unknown model fields", () => {
    const uniqueMap: UniqueMap = {
      User: [
        {
          selector: "tenant_missing",
          fields: ["tenantId", "missing"],
        },
      ],
    };

    expect(() =>
      build(
        {
          tenant_missing: {
            tenantId: true,
            missing: true,
          },
        },
        TYPE_MAP,
        uniqueMap,
      ),
    ).toThrow('Unknown field "missing" on related model "User"');
  });

  it("rejects relation fields in compound selectors", () => {
    const uniqueMap: UniqueMap = {
      User: [
        {
          selector: "tenant_relation",
          fields: ["tenantId", "relationKey"],
        },
      ],
    };

    expect(() =>
      build(
        {
          tenant_relation: {
            tenantId: true,
            relationKey: true,
          },
        },
        TYPE_MAP,
        uniqueMap,
      ),
    ).toThrow('Relation field "relationKey" cannot be used');
  });

  it("rejects non-unique single selector keys", () => {
    expect(() => build({ slug: true })).toThrow(
      'Field "slug" in connect on "Parent.user" is not a unique selector',
    );
  });

  it("requires single selector configs to be true", () => {
    expect(() => build({ id: false })).toThrow(
      'Field "id" in connect on "Parent.user" must be true',
    );
  });

  it("rejects single constraints with missing model fields", () => {
    const uniqueMap: UniqueMap = {
      User: [{ selector: "ghost", fields: ["ghost"] }],
    };

    expect(() => build({ ghost: true }, TYPE_MAP, uniqueMap)).toThrow(
      'Unknown field "ghost" on related model "User"',
    );
  });

  it("rejects relation fields in single selectors", () => {
    expect(() => build({ relationKey: true })).toThrow(
      'Relation field "relationKey" cannot be used in unique selector',
    );
  });
});

describe("buildUniqueSelectorSchema parsing", () => {
  it("parses and coerces a compound selector", () => {
    const schema = build({
      tenant_slug: {
        tenantId: true,
        slug: true,
      },
    });

    expect(
      schema.parse({
        tenant_slug: {
          tenantId: 123,
          slug: "admin",
        },
      }),
    ).toEqual({
      tenant_slug: {
        tenantId: "123",
        slug: "admin",
      },
    });
  });

  it("rejects unknown fields in compound selector values", () => {
    const schema = build({
      tenant_slug: {
        tenantId: true,
        slug: true,
      },
    });

    expect(() =>
      schema.parse({
        tenant_slug: {
          tenantId: "tenant",
          slug: "admin",
          extra: true,
        },
      }),
    ).toThrow();
  });

  it("parses single selectors and requires at least one value", () => {
    const schema = build({ id: true, externalId: true });

    expect(schema.parse({ id: 123 })).toEqual({ id: "123" });
    expect(schema.parse({ externalId: "external" })).toEqual({
      externalId: "external",
    });
    expect(() => schema.parse({})).toThrow(
      "requires at least one unique selector value",
    );
  });

  it("rejects unknown top-level selector values", () => {
    const schema = build({ id: true });

    expect(() => schema.parse({ id: "1", extra: true })).toThrow();
  });

  it("keeps nullable unique selector values non-nullable", () => {
    const schema = build({ externalId: true });

    expect(() => schema.parse({ externalId: null })).toThrow();
  });

  it("parses enum unique selectors", () => {
    const schema = build({ role: true });

    expect(schema.parse({ role: "ADMIN" })).toEqual({ role: "ADMIN" });
    expect(() => schema.parse({ role: "OTHER" })).toThrow();
  });

  it("parses unsupported unique selector values", () => {
    const schema = build({ unsupportedKey: true });
    const value = { custom: true };

    expect(schema.parse({ unsupportedKey: value })).toEqual({
      unsupportedKey: value,
    });
  });
});
