import { describe, expect, it } from "vitest";
import type { DMMF } from "@prisma/generator-helper";
import { emitClient } from "../../src/generator/emit-client.js";
import { emitTypedShapes } from "../../src/generator/emit-typed-shapes.js";

function dmmfWithModels(names: string[]): DMMF.Document {
  return {
    datamodel: {
      models: names.map((name) => ({ name })),
      enums: [],
      types: [],
      indexes: [],
    },
  } as unknown as DMMF.Document;
}

describe("emitClient import-path safety", () => {
  it("escapes a runtimeImportPath containing a quote instead of breaking the string literal", () => {
    const output = emitClient("none", "weird'path");

    // The malicious path is emitted as a properly escaped string literal, not
    // spliced into raw single-quoted source.
    expect(output).toContain(`from ${JSON.stringify("weird'path")}`);
    expect(output).not.toContain("from 'weird'path'");
  });
});

describe("emitTypedShapes identifier-collision safety", () => {
  it("aliases imported helpers so a model named 'Typed' does not duplicate an identifier", () => {
    const output = emitTypedShapes(dmmfWithModels(["Typed"]), 1, "none", "prisma-guard");

    // Emitted aliases for the model.
    expect(output).toContain("export type TypedProjection = TypedSelect");
    expect(output).toContain("export type TypedInclude =");
    expect(output).toContain("export type TypedGuardShape =");

    // The imported helpers are aliased with a leading underscore, so the RHS
    // references never collide with the emitted `Typed*` type names.
    expect(output).toContain("TypedProjection as _TypedProjection");
    expect(output).toContain("_TypedProjection<");
    expect(output).toContain("_TypedGuardShape<");

    // No un-aliased import identifier that would clash with an emitted alias.
    expect(output).not.toContain("\n  TypedProjection,\n");
    expect(output).not.toMatch(/=\s*TypedProjection</);
  });
});
