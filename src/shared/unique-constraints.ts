import type { DMMF } from '@prisma/generator-helper'
import type { UniqueConstraint } from './types.js'

export interface UniqueConstraintMeta {
  selector: string
  fields: string[]
}

export function uniqueSelector(fields: string[], name?: string | null): string {
  if (typeof name === 'string' && name.trim().length > 0) return name
  return fields.join('_')
}

export function fieldsKey(fields: string[]): string {
  return fields.join('\0')
}

export function formatUniqueConstraint(constraint: UniqueConstraint | UniqueConstraintMeta): string {
  return constraint.fields.length === 1
    ? constraint.selector
    : `${constraint.selector}(${constraint.fields.join(', ')})`
}

export function formatUniqueConstraints(
  constraints: readonly (UniqueConstraint | UniqueConstraintMeta)[],
): string {
  return constraints.map(formatUniqueConstraint).join(' | ')
}

export function collectUniqueConstraints(model: DMMF.Model): UniqueConstraintMeta[] {
  const fieldSetSeen = new Set<string>()
  const selectorToFields = new Map<string, string>()
  const constraints: UniqueConstraintMeta[] = []

  function add(fields: string[], selector?: string | null): void {
    if (fields.length === 0) return

    const normalizedSelector =
      fields.length === 1 ? fields[0] : uniqueSelector(fields, selector)

    const key = fieldsKey(fields)
    const existingFieldsForSelector = selectorToFields.get(normalizedSelector)

    if (existingFieldsForSelector && existingFieldsForSelector !== key) {
      throw new Error(
        `prisma-guard: Unique selector "${normalizedSelector}" on model "${model.name}" maps to multiple field sets.`,
      )
    }

    if (fieldSetSeen.has(key)) return

    fieldSetSeen.add(key)
    selectorToFields.set(normalizedSelector, key)

    constraints.push({
      selector: normalizedSelector,
      fields: [...fields],
    })
  }

  for (const field of model.fields) {
    if (field.isId) add([field.name], field.name)
  }

  if (model.primaryKey) {
    add([...model.primaryKey.fields], model.primaryKey.name)
  }

  for (const field of model.fields) {
    if (field.isUnique) add([field.name], field.name)
  }

  const uniqueIndexes =
    (
      model as DMMF.Model & {
        uniqueIndexes?: Array<{ name?: string | null; fields: string[] }>
      }
    ).uniqueIndexes ?? []

  for (const index of uniqueIndexes) {
    add([...index.fields], index.name)
  }

  for (const fields of model.uniqueFields) {
    add([...fields], fields.length === 1 ? fields[0] : fields.join('_'))
  }

  return constraints
}