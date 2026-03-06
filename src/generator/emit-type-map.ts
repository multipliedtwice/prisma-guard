import type { DMMF } from '@prisma/generator-helper'

const SKIP_FIELD_KINDS = new Set(['unsupported'])

export function emitTypeMap(dmmf: DMMF.Document): string {
  const enumNames = new Set(dmmf.datamodel.enums.map(e => e.name))

  for (const e of dmmf.datamodel.enums) {
    if (e.values.length === 0) {
      throw new Error(`prisma-guard: Enum "${e.name}" has zero values.`)
    }
  }

  const modelEntries = dmmf.datamodel.models
    .map(model => {
      const fieldEntries = model.fields
        .filter(field => !SKIP_FIELD_KINDS.has(field.kind))
        .map(field => {
          const isRelation = field.kind === 'object' || field.relationName != null
          const isEnum = enumNames.has(field.type)
          const meta: string[] = [
            `type: ${JSON.stringify(field.type)}`,
            `isList: ${field.isList}`,
            `isRequired: ${field.isRequired}`,
            `isId: ${field.isId}`,
            `isRelation: ${isRelation}`,
            `hasDefault: ${field.hasDefaultValue}`,
            `isUpdatedAt: ${field.isUpdatedAt}`,
          ]
          if (isEnum) meta.push(`isEnum: true`)
          return `    ${JSON.stringify(field.name)}: { ${meta.join(', ')} },`
        })
        .join('\n')
      return `  ${JSON.stringify(model.name)}: {\n${fieldEntries}\n  },`
    })
    .join('\n')

  const enumEntries = dmmf.datamodel.enums
    .map(e => {
      const values = e.values.map(v => JSON.stringify(v.name)).join(', ')
      return `  ${JSON.stringify(e.name)}: [${values}],`
    })
    .join('\n')

  const typeMapSource = `export const TYPE_MAP = {\n${modelEntries}\n} as const\n`
  const enumMapSource = `export const ENUM_MAP = {\n${enumEntries}\n} as const\n`

  const typesSource = [
    `export type ModelName = keyof typeof TYPE_MAP`,
    `export type FieldName<M extends ModelName> = keyof (typeof TYPE_MAP)[M]`,
  ].join('\n')

  return `${typeMapSource}\n${enumMapSource}\n${typesSource}\n`
}