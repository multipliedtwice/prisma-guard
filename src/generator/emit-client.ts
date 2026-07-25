import type { DMMF } from '@prisma/generator-helper'
import {
  withImportStyle,
  withClientImportStyle,
  type ImportStyle,
  type PrismaClientKind,
} from './import-style.js'

function delegateKey(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1)
}

function emitGuardModelExtension(dmmf: DMMF.Document): string {
  const entries = dmmf.datamodel.models
    .map((model) => {
      const key = delegateKey(model.name)
      return `  ${key}: {
    guard(input: GuardInput, caller?: string): GuardedModel<PrismaClient['${key}']>
  }`
    })
    .join('\n')

  return `interface GuardModelExtension {
${entries}
}
`
}

export function emitClient(
  dmmf: DMMF.Document,
  prismaClientImport: string,
  prismaClientKind: PrismaClientKind,
  importStyle: ImportStyle,
  runtimeImportPath: string,
): string {
  const indexImport = withImportStyle('./index', importStyle)
  const clientImport = withClientImportStyle(
    prismaClientImport,
    importStyle,
    prismaClientKind,
  )

  const clientLit = JSON.stringify(clientImport)
  const runtimeLit = JSON.stringify(runtimeImportPath)
  const indexLit = JSON.stringify(indexImport)

  return `import type { PrismaClient } from ${clientLit}
import type { GuardInput, GuardedModel } from ${runtimeLit}
import { createGuard } from ${runtimeLit}
import { SCOPE_MAP, TYPE_MAP, ENUM_MAP, ZOD_CHAINS, GUARD_CONFIG, UNIQUE_MAP, ZOD_DEFAULTS } from ${indexLit}
import type { ScopeRoot } from ${indexLit}

${emitGuardModelExtension(dmmf)}
export const guard = createGuard<typeof TYPE_MAP, ScopeRoot, GuardModelExtension>({
  scopeMap: SCOPE_MAP,
  typeMap: TYPE_MAP,
  enumMap: ENUM_MAP,
  zodChains: ZOD_CHAINS,
  guardConfig: GUARD_CONFIG,
  uniqueMap: UNIQUE_MAP,
  zodDefaults: ZOD_DEFAULTS,
})
`
}