import type { DMMF } from '@prisma/generator-helper'

function isScopeRoot(documentation: string | undefined): boolean {
  if (!documentation) return false
  const tokens = documentation.split(/[\s\n\r]+/)
  return tokens.some(t => t === '@scope-root')
}

interface RelationEntry {
  fks: string[]
  root: string
  relationName: string
}

export function emitScopeMap(
  dmmf: DMMF.Document,
  onAmbiguousScope: 'error' | 'warn' | 'ignore',
): { source: string } {
  const rootModels = new Set<string>()

  for (const model of dmmf.datamodel.models) {
    if (isScopeRoot(model.documentation)) {
      rootModels.add(model.name)
    }
  }

  const scopeMap: Record<string, { fk: string; root: string; relationName: string }[]> = {}

  for (const model of dmmf.datamodel.models) {
    if (rootModels.has(model.name)) continue

    const relations: RelationEntry[] = []

    for (const field of model.fields) {
      if (!field.relationFromFields || field.relationFromFields.length === 0) continue
      if (!rootModels.has(field.type)) continue

      if (field.relationFromFields.length > 1) {
        const msg = `Model "${model.name}" has a composite foreign key to scope root "${field.type}" via relation "${field.name}" ` +
          `(fields: ${field.relationFromFields.join(', ')}). Composite scope relations are not supported.`

        if (onAmbiguousScope === 'error') {
          throw new Error(`prisma-guard: ${msg}`)
        }

        if (onAmbiguousScope === 'warn') {
          console.warn(`prisma-guard: ${msg} Excluding relation "${field.name}" to scope root "${field.type}" from scope map for model "${model.name}".`)
        }

        continue
      }

      relations.push({
        fks: [...field.relationFromFields],
        root: field.type,
        relationName: field.name,
      })
    }

    if (relations.length === 0) continue

    const relationsByRoot: Record<string, RelationEntry[]> = {}
    for (const rel of relations) {
      if (!relationsByRoot[rel.root]) relationsByRoot[rel.root] = []
      relationsByRoot[rel.root].push(rel)
    }

    const entries: { fk: string; root: string; relationName: string }[] = []

    for (const [root, rels] of Object.entries(relationsByRoot)) {
      if (rels.length > 1) {
        const relNames = rels.map(r => r.relationName)
        const msg = `Model "${model.name}" has multiple relations to scope root "${root}" (${relNames.join(', ')}).`

        if (onAmbiguousScope === 'error') {
          throw new Error(
            `prisma-guard: Ambiguous scope detected. Resolve these or set onAmbiguousScope to "warn" or "ignore":\n` +
            `  - ${msg}`,
          )
        }

        if (onAmbiguousScope === 'warn') {
          console.warn(`prisma-guard: ${msg} Excluding relations to scope root "${root}" from scope map for model "${model.name}".`)
        }

        continue
      }

      entries.push({
        fk: rels[0].fks[0],
        root: rels[0].root,
        relationName: rels[0].relationName,
      })
    }

    if (entries.length > 0) {
      scopeMap[model.name] = entries
    }
  }

  const roots = Array.from(rootModels).sort()

  const mapEntries = Object.entries(scopeMap)
    .map(([model, entries]) => {
      const entriesStr = entries
        .map(e => `{ fk: ${JSON.stringify(e.fk)}, root: ${JSON.stringify(e.root)}, relationName: ${JSON.stringify(e.relationName)} }`)
        .join(', ')
      return `  ${model}: [${entriesStr}],`
    })
    .join('\n')

  const scopeRootType = roots.length > 0
    ? roots.map(r => `'${r}'`).join(' | ')
    : 'never'

  const source = `export const SCOPE_MAP = {\n${mapEntries}\n} as const\n\nexport type ScopeRoot = ${scopeRootType}\n`

  return { source }
}