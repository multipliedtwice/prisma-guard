import { describe, expect, it } from "vitest";
import {
  collectUniqueConstraints,
  fieldsKey,
  formatUniqueConstraint,
  formatUniqueConstraints,
  uniqueSelector,
} from "../../src/shared/unique-constraints.js";

function model(input: Record<string, unknown>) {
  return {
    name: "Account",
    fields: [],
    uniqueFields: [],
    uniqueIndexes: [],
    primaryKey: null,
    ...input,
  } as any;
}

describe("unique constraint helpers", () => {
  it("uses an explicit non-blank selector name", () => {
    expect(uniqueSelector(["tenantId", "slug"], "tenant_slug")).toBe(
      "tenant_slug",
    );
  });

  it("derives a selector for missing or blank names", () => {
    expect(uniqueSelector(["tenantId", "slug"])).toBe("tenantId_slug");
    expect(uniqueSelector(["tenantId", "slug"], null)).toBe(
      "tenantId_slug",
    );
    expect(uniqueSelector(["tenantId", "slug"], "   ")).toBe(
      "tenantId_slug",
    );
  });

  it("builds an unambiguous field-set key", () => {
    expect(fieldsKey(["a", "bc"])).not.toBe(fieldsKey(["ab", "c"]));
    expect(fieldsKey(["a", "b"])).toBe("a\0b");
  });

  it("formats single and compound constraints", () => {
    expect(formatUniqueConstraint({ selector: "id", fields: ["id"] })).toBe(
      "id",
    );
    expect(
      formatUniqueConstraint({
        selector: "tenant_slug",
        fields: ["tenantId", "slug"],
      }),
    ).toBe("tenant_slug(tenantId, slug)");
  });

  it("formats multiple constraints", () => {
    expect(
      formatUniqueConstraints([
        { selector: "id", fields: ["id"] },
        {
          selector: "tenant_slug",
          fields: ["tenantId", "slug"],
        },
      ]),
    ).toBe("id | tenant_slug(tenantId, slug)");
  });
});

describe("collectUniqueConstraints", () => {
  it("collects ids, primary keys, unique fields, indexes, and uniqueFields", () => {
    const input = model({
      fields: [
        { name: "id", isId: true, isUnique: false },
        { name: "email", isId: false, isUnique: true },
        { name: "tenantId", isId: false, isUnique: false },
        { name: "slug", isId: false, isUnique: false },
        { name: "region", isId: false, isUnique: false },
        { name: "externalId", isId: false, isUnique: false },
      ],
      primaryKey: {
        name: "tenant_slug",
        fields: ["tenantId", "slug"],
      },
      uniqueIndexes: [
        {
          name: "tenant_slug",
          fields: ["tenantId", "slug"],
        },
        {
          name: null,
          fields: ["region", "externalId"],
        },
      ],
      uniqueFields: [
        ["email"],
        ["tenantId", "slug"],
        ["legacyA", "legacyB"],
        [],
      ],
    });

    expect(collectUniqueConstraints(input)).toEqual([
      { selector: "id", fields: ["id"] },
      {
        selector: "tenant_slug",
        fields: ["tenantId", "slug"],
      },
      { selector: "email", fields: ["email"] },
      {
        selector: "region_externalId",
        fields: ["region", "externalId"],
      },
      {
        selector: "legacyA_legacyB",
        fields: ["legacyA", "legacyB"],
      },
    ]);
  });

  it("returns an empty list when the model has no unique constraints", () => {
    expect(collectUniqueConstraints(model({}))).toEqual([]);
  });

  it("uses the field name for a single-field primary key", () => {
    const input = model({
      fields: [{ name: "accountId", isId: false, isUnique: false }],
      primaryKey: {
        name: "custom_primary_name",
        fields: ["accountId"],
      },
    });

    expect(collectUniqueConstraints(input)).toEqual([
      { selector: "accountId", fields: ["accountId"] },
    ]);
  });

  it("rejects one selector mapping to different compound field sets", () => {
    const input = model({
      fields: [],
      primaryKey: {
        name: "duplicate_selector",
        fields: ["tenantId", "slug"],
      },
      uniqueIndexes: [
        {
          name: "duplicate_selector",
          fields: ["region", "externalId"],
        },
      ],
    });

    expect(() => collectUniqueConstraints(input)).toThrow(
      'Unique selector "duplicate_selector" on model "Account" maps to multiple field sets',
    );
  });

  it("rejects a generated compound selector colliding with a single field", () => {
    const input = model({
      fields: [{ name: "tenant_slug", isId: false, isUnique: true }],
      uniqueIndexes: [
        {
          name: null,
          fields: ["tenant", "slug"],
        },
      ],
    });

    expect(() => collectUniqueConstraints(input)).toThrow(
      'Unique selector "tenant_slug" on model "Account" maps to multiple field sets',
    );
  });
});
