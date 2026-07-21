import { describe, expect, it, vi } from "vitest";
import { createModelGuardExtension } from "../../src/runtime/model-guard.js";
import { createQueryBuilder } from "../../src/runtime/query-builder.js";
import { buildUniqueSelectorSchema } from "../../src/runtime/unique-selector-schema.js";
import { force } from "../../src/shared/constants.js";
import { createScalarBase } from "../../src/shared/scalar-base.js";
import type {
  EnumMap,
  GuardInput,
  TypeMap,
  UniqueMap,
} from "../../src/shared/types.js";

const TYPE_MAP: TypeMap = {
  Assignment: {
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
    externalId: {
      type: "String",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
      isUnique: true,
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
    slug: {
      type: "String",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
    deletedAt: {
      type: "DateTime",
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
    talentNote: {
      type: "String",
      isList: false,
      isRequired: false,
      isId: false,
      isRelation: false,
      hasDefault: false,
      isUpdatedAt: false,
    },
  },
  Parent: {
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
  },
};

const ENUM_MAP: EnumMap = {};

const UNIQUE_MAP: UniqueMap = {
  Assignment: [
    { selector: "id", fields: ["id"] },
    { selector: "externalId", fields: ["externalId"] },
    { selector: "tenantId_slug", fields: ["tenantId", "slug"] },
  ],
  Parent: [{ selector: "id", fields: ["id"] }],
};

const scalarBase = createScalarBase(false);

function makeQueryBuilder() {
  return createQueryBuilder(TYPE_MAP, ENUM_MAP, UNIQUE_MAP, scalarBase);
}

function makeGuardedAssignment(input: GuardInput) {
  const update = vi.fn((args: unknown) => args);
  const extension = createModelGuardExtension({
    typeMap: TYPE_MAP,
    enumMap: ENUM_MAP,
    zodChains: {},
    zodDefaults: {},
    uniqueMap: UNIQUE_MAP,
    scopeMap: {},
    guardConfig: { onMissingScopeContext: "error" },
    contextFn: () => ({}),
  });

  const assignment = extension.assignment.guard.call(
    {
      $parent: {
        assignment: { update },
      },
    },
    input,
  );

  return { assignment, update };
}

describe("extended unique where nullable fields", () => {
  it("accepts a forced null nullable field alongside a unique id", () => {
    const { assignment, update } = makeGuardedAssignment({
      where: {
        id: true,
        deletedAt: force(null),
      },
      data: {
        talentNote: true,
      },
    });

    const result = assignment.update({
      where: {
        id: "assignment-id",
      },
      data: {
        talentNote: "Updated note",
      },
    });

    const expected = {
      where: {
        id: "assignment-id",
        deletedAt: null,
      },
      data: {
        talentNote: "Updated note",
      },
    };

    expect(result).toEqual(expected);
    expect(update).toHaveBeenCalledWith(expected);
  });

  it("accepts a client null nullable field alongside a unique id", () => {
    const { assignment } = makeGuardedAssignment({
      where: {
        id: true,
        deletedAt: true,
      },
      data: {
        talentNote: true,
      },
    });

    const result = assignment.update({
      where: {
        id: "assignment-id",
        deletedAt: null,
      },
      data: {
        talentNote: "Updated note",
      },
    });

    expect(result.where).toEqual({
      id: "assignment-id",
      deletedAt: null,
    });
  });

  it("rejects null for a required direct DateTime field", () => {
    const { assignment } = makeGuardedAssignment({
      where: {
        id: true,
        updatedAt: true,
      },
      data: {
        talentNote: true,
      },
    });

    expect(() =>
      assignment.update({
        where: {
          id: "assignment-id",
          updatedAt: null,
        },
        data: {
          talentNote: "Updated note",
        },
      }),
    ).toThrow();
  });

  it.each([
    new Date("2026-07-21T12:00:00.000Z"),
    "2026-07-21T12:00:00.000Z",
  ])("accepts a forced non-null DateTime value: %s", (updatedAt) => {
    const { assignment } = makeGuardedAssignment({
      where: {
        id: true,
        updatedAt: force(updatedAt),
      },
      data: {
        talentNote: true,
      },
    });

    const result = assignment.update({
      where: {
        id: "assignment-id",
      },
      data: {
        talentNote: "Updated note",
      },
    });

    expect(result.where).toEqual({
      id: "assignment-id",
      updatedAt: new Date("2026-07-21T12:00:00.000Z"),
    });
  });

  it("rejects a forced null as the sole unique selector", () => {
    const { assignment } = makeGuardedAssignment({
      where: {
        externalId: force(null),
      },
      data: {
        talentNote: true,
      },
    });

    expect(() =>
      assignment.update({
        data: {
          talentNote: "Updated note",
        },
      }),
    ).toThrow(/forced non-null value/);
  });

  it("rejects a client null as the sole resolved unique selector", () => {
    const { assignment } = makeGuardedAssignment({
      where: {
        externalId: true,
      },
      data: {
        talentNote: true,
      },
    });

    expect(() =>
      assignment.update({
        where: {
          externalId: null,
        },
        data: {
          talentNote: "Updated note",
        },
      }),
    ).toThrow(/requires resolved where to cover a unique constraint/);
  });

  it("rejects a nullable compound selector member set to null", () => {
    const { assignment } = makeGuardedAssignment({
      where: {
        tenantId_slug: {
          tenantId: true,
          slug: true,
        },
      },
      data: {
        talentNote: true,
      },
    });

    expect(() =>
      assignment.update({
        where: {
          tenantId_slug: {
            tenantId: "tenant-id",
            slug: null,
          },
        },
        data: {
          talentNote: "Updated note",
        },
      }),
    ).toThrow();
  });

  it("rejects a forced compound selector containing null", () => {
    const { assignment } = makeGuardedAssignment({
      where: {
        tenantId_slug: force({
          tenantId: "tenant-id",
          slug: null,
        }),
      },
      data: {
        talentNote: true,
      },
    });

    expect(() =>
      assignment.update({
        data: {
          talentNote: "Updated note",
        },
      }),
    ).toThrow(/forced non-null value/);
  });
});

describe("non-filter direct scalar paths remain non-nullable", () => {
  it("rejects null for a nullable unique cursor field", () => {
    const schema = makeQueryBuilder().buildQuerySchema(
      "Assignment",
      "findMany",
      {
        cursor: {
          externalId: true,
        },
      },
    );

    expect(() =>
      schema.parse({
        cursor: {
          externalId: null,
        },
      }),
    ).toThrow();
  });

  it("rejects null for a nullable relation unique selector", () => {
    const schema = buildUniqueSelectorSchema(
      "Parent",
      "assignment",
      "Assignment",
      {
        externalId: true,
      },
      TYPE_MAP,
      UNIQUE_MAP,
      ENUM_MAP,
      scalarBase,
      "connect",
    );

    expect(() =>
      schema.parse({
        externalId: null,
      }),
    ).toThrow();
  });

  it("rejects a sole nullable unique null through query parser", () => {
    const schema = makeQueryBuilder().buildQuerySchema(
      "Assignment",
      "findUnique",
      {
        where: {
          externalId: true,
        },
      },
    );

    expect(() =>
      schema.parse({
        where: {
          externalId: null,
        },
      }),
    ).toThrow(/requires resolved where to cover a unique constraint/);
  });
});
