import type { DMMF } from "@prisma/generator-helper";

interface UniqueConstraintMeta {
  selector: string;
  fields: string[];
}

function uniqueSelector(fields: string[], name?: string | null): string {
  if (typeof name === "string" && name.trim().length > 0) return name;
  return fields.join("_");
}

function collectUniqueConstraints(model: DMMF.Model): UniqueConstraintMeta[] {
  const fieldSetSeen = new Set<string>();
  const selectorToFields = new Map<string, string>();
  const constraints: UniqueConstraintMeta[] = [];

  function fieldsKey(fields: string[]): string {
    return fields.join("\0");
  }

  function add(fields: string[], selector?: string | null): void {
    if (fields.length === 0) return;

    const normalizedSelector =
      fields.length === 1 ? fields[0] : uniqueSelector(fields, selector);

    const key = fieldsKey(fields);
    const existingFieldsForSelector = selectorToFields.get(normalizedSelector);

    if (existingFieldsForSelector && existingFieldsForSelector !== key) {
      throw new Error(
        `prisma-guard: Unique selector "${normalizedSelector}" on model "${model.name}" maps to multiple field sets.`,
      );
    }

    if (fieldSetSeen.has(key)) return;

    fieldSetSeen.add(key);
    selectorToFields.set(normalizedSelector, key);

    constraints.push({
      selector: normalizedSelector,
      fields: [...fields],
    });
  }

  for (const field of model.fields) {
    if (field.isId) add([field.name], field.name);
  }

  if (model.primaryKey) {
    add([...model.primaryKey.fields], model.primaryKey.name);
  }

  for (const field of model.fields) {
    if (field.isUnique) add([field.name], field.name);
  }

  const uniqueIndexes =
    (
      model as DMMF.Model & {
        uniqueIndexes?: Array<{ name?: string | null; fields: string[] }>;
      }
    ).uniqueIndexes ?? [];

  for (const index of uniqueIndexes) {
    add([...index.fields], index.name);
  }

  for (const fields of model.uniqueFields) {
    add([...fields], fields.length === 1 ? fields[0] : fields.join("_"));
  }

  return constraints;
}

export function emitTypeMap(dmmf: DMMF.Document): string {
  const enumNames = new Set(dmmf.datamodel.enums.map((e) => e.name));

  for (const e of dmmf.datamodel.enums) {
    if (e.values.length === 0) {
      throw new Error(`prisma-guard: Enum "${e.name}" has zero values.`);
    }
  }

  const modelEntries = dmmf.datamodel.models
    .map((model) => {
      const fieldEntries = model.fields
        .map((field) => {
          const isRelation =
            field.kind === "object" || field.relationName != null;
          const isEnum = enumNames.has(field.type);
          const isUnsupported = field.kind === "unsupported";
          const meta: string[] = [
            `type: ${JSON.stringify(field.type)}`,
            `isList: ${field.isList}`,
            `isRequired: ${field.isRequired}`,
            `isId: ${field.isId}`,
            `isRelation: ${isRelation}`,
            `hasDefault: ${field.hasDefaultValue}`,
            `isUpdatedAt: ${field.isUpdatedAt}`,
          ];
          if (isEnum) meta.push(`isEnum: true`);
          if (isUnsupported) meta.push(`isUnsupported: true`);
          if (field.isUnique) meta.push(`isUnique: true`);
          return `    ${JSON.stringify(field.name)}: { ${meta.join(", ")} },`;
        })
        .join("\n");
      return `  ${JSON.stringify(model.name)}: {\n${fieldEntries}\n  },`;
    })
    .join("\n");

  const enumEntries = dmmf.datamodel.enums
    .map((e) => {
      const values = e.values.map((v) => JSON.stringify(v.name)).join(", ");
      return `  ${JSON.stringify(e.name)}: [${values}],`;
    })
    .join("\n");

  const uniqueMapEntries = dmmf.datamodel.models
    .map((model) => {
      const constraints = collectUniqueConstraints(model);
      if (constraints.length === 0) return null;

      const constraintsStr = constraints
        .map((c) => {
          const fields = c.fields.map((f) => JSON.stringify(f)).join(", ");
          return `{ selector: ${JSON.stringify(c.selector)}, fields: [${fields}] }`;
        })
        .join(", ");

      return `  ${JSON.stringify(model.name)}: [${constraintsStr}],`;
    })
    .filter(Boolean)
    .join("\n");

  const typeMapSource = `export const TYPE_MAP = {\n${modelEntries}\n} as const\n`;
  const enumMapSource = `export const ENUM_MAP = {\n${enumEntries}\n} as const\n`;
  const uniqueMapSource = `export const UNIQUE_MAP = {\n${uniqueMapEntries}\n} as const\n`;

  const typesSource = [
    `export type ModelName = keyof typeof TYPE_MAP`,
    `export type FieldName<M extends ModelName> = keyof (typeof TYPE_MAP)[M]`,
  ].join("\n");

  return `${typeMapSource}\n${enumMapSource}\n${uniqueMapSource}\n${typesSource}\n`;
}
