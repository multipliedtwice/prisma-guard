import type { DMMF } from '@prisma/generator-helper'
import { collectUniqueConstraints } from '../shared/unique-constraints.js'

function serializeMeta(entries: Array<[string, unknown]>): string {
  return entries
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
}

export function emitTypeMap(dmmf: DMMF.Document): string {
  const enumNames = new Set(dmmf.datamodel.enums.map((e) => e.name))

  for (const e of dmmf.datamodel.enums) {
    if (e.values.length === 0) {
      throw new Error(`prisma-guard: Enum "${e.name}" has zero values.`)
    }
  }

  const modelEntries = dmmf.datamodel.models
    .map((model) => {
      const fieldEntries = model.fields
        .map((field) => {
          const isRelation =
            field.kind === 'object' || field.relationName != null
          const isEnum = enumNames.has(field.type)
          const isUnsupported = field.kind === 'unsupported'

          const metaPairs: Array<[string, unknown]> = [
            ['type', field.type],
            ['isList', field.isList],
            ['isRequired', field.isRequired],
            ['isId', field.isId],
            ['isRelation', isRelation],
            ['hasDefault', field.hasDefaultValue],
            ['isUpdatedAt', field.isUpdatedAt],
          ]
          if (isEnum) metaPairs.push(['isEnum', true])
          if (isUnsupported) metaPairs.push(['isUnsupported', true])
          if (field.isUnique) metaPairs.push(['isUnique', true])

          return `    ${JSON.stringify(field.name)}: { ${serializeMeta(metaPairs)} },`
        })
        .join('\n')
      return `  ${JSON.stringify(model.name)}: {\n${fieldEntries}\n  },`
    })
    .join('\n')

  const enumEntries = dmmf.datamodel.enums
    .map((e) => {
      const values = e.values.map((v) => JSON.stringify(v.name)).join(', ')
      return `  ${JSON.stringify(e.name)}: [${values}],`
    })
    .join('\n')

  const uniqueMapEntries = dmmf.datamodel.models
    .map((model) => {
      const constraints = collectUniqueConstraints(model)
      if (constraints.length === 0) return null

      const constraintsStr = constraints
        .map((c) => {
          const fields = c.fields.map((f) => JSON.stringify(f)).join(', ')
          return `{ selector: ${JSON.stringify(c.selector)}, fields: [${fields}] }`
        })
        .join(', ')

      return `  ${JSON.stringify(model.name)}: [${constraintsStr}],`
    })
    .filter(Boolean)
    .join('\n')

  const typeMapSource = `export const TYPE_MAP = {\n${modelEntries}\n} as const\n`
  const enumMapSource = `export const ENUM_MAP = {\n${enumEntries}\n} as const\n`
  const uniqueMapSource = `export const UNIQUE_MAP = {\n${uniqueMapEntries}\n} as const\n`

  const typesSource = [
    `export type ModelName = keyof typeof TYPE_MAP`,
    `export type FieldName<M extends ModelName> = keyof (typeof TYPE_MAP)[M]`,
  ].join('\n')

  return `${typeMapSource}\n${enumMapSource}\n${uniqueMapSource}\n${typesSource}\n`
}