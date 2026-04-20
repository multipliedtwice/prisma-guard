import type { DMMF } from '@prisma/generator-helper'

function collectUniqueConstraints(model: DMMF.Model): string[][] {
  const seen = new Set<string>()
  const constraints: string[][] = []

  function add(fields: string[]) {
    const key = fields.join('\0')
    if (seen.has(key)) return
    seen.add(key)
    constraints.push(fields)
  }

  for (const field of model.fields) {
    if (field.isId) add([field.name])
  }

  if (model.primaryKey) {
    add([...model.primaryKey.fields])
  }

  for (const field of model.fields) {
    if (field.isUnique) add([field.name])
  }

  for (const fields of model.uniqueFields) {
    add([...fields])
  }

  return constraints
}

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
        .map(field => {
          const isRelation = field.kind === 'object' || field.relationName != null
          const isEnum = enumNames.has(field.type)
          const isUnsupported = field.kind === 'unsupported'
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
          if (isUnsupported) meta.push(`isUnsupported: true`)
          if (field.isUnique) meta.push(`isUnique: true`)
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

  const uniqueMapEntries = dmmf.datamodel.models
    .map(model => {
      const constraints = collectUniqueConstraints(model)
      if (constraints.length === 0) return null
      const constraintsStr = constraints
        .map(c => `[${c.map(f => JSON.stringify(f)).join(', ')}]`)
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