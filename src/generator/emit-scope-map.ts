import type { DMMF } from '@prisma/generator-helper'

function isScopeRoot(documentation: string | undefined): boolean {
  if (!documentation) return false
  const tokens = documentation.split(/[\s\n\r]+/)
  return tokens.some(t => t === '@scope-root')
}

export function emitScopeMap(
  dmmf: DMMF.Document,
  onAmbiguousScope: 'error' | 'warn' | 'ignore',
): { source: string; roots: string[] } {
  const rootModels = new Set<string>()

  for (const model of dmmf.datamodel.models) {
    if (isScopeRoot(model.documentation)) {
      rootModels.add(model.name)
    }
  }

  const scopeMap: Record<string, { fk: string; root: string; relationName: string }[]> = {}

  for (const model of dmmf.datamodel.models) {
    if (rootModels.has(model.name)) continue

    const entries: { fk: string; root: string; relationName: string }[] = []

    for (const field of model.fields) {
      if (!field.relationFromFields || field.relationFromFields.length === 0) continue
      if (!rootModels.has(field.type)) continue

      for (const fk of field.relationFromFields) {
        entries.push({ fk, root: field.type, relationName: field.name })
      }
    }

    if (entries.length > 0) {
      scopeMap[model.name] = entries
    }
  }

  const excludedModels = new Set<string>()
  const ambiguityMessages: string[] = []

  for (const [modelName, entries] of Object.entries(scopeMap)) {
    const rootCounts: Record<string, string[]> = {}
    for (const entry of entries) {
      if (!rootCounts[entry.root]) rootCounts[entry.root] = []
      rootCounts[entry.root].push(entry.fk)
    }
    for (const [root, fks] of Object.entries(rootCounts)) {
      if (fks.length > 1) {
        ambiguityMessages.push(
          `Model "${modelName}" has multiple FKs to scope root "${root}" (${fks.join(', ')}). Excluding from scope map.`,
        )
        excludedModels.add(modelName)
      }
    }
  }

  if (ambiguityMessages.length > 0) {
    if (onAmbiguousScope === 'error') {
      throw new Error(
        `prisma-guard: Ambiguous scope detected. Resolve these or set onAmbiguousScope to "warn" or "ignore":\n${ambiguityMessages.map(m => `  - ${m}`).join('\n')}`,
      )
    }
    if (onAmbiguousScope === 'warn') {
      for (const msg of ambiguityMessages) {
        console.warn(`prisma-guard: ${msg}`)
      }
    }
  }

  for (const name of excludedModels) {
    delete scopeMap[name]
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

  return { source, roots }
}