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
      return (
        `  ${key}: {\n` +
        `    guard(input: GuardInput, caller?: string): GuardedModel<PrismaClient['${key}']>\n` +
        `  }`
      )
    })
    .join('\n')

  return `interface GuardModelExtension {\n${entries}\n}\n`
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

  return (
    `import type { PrismaClient } from '${clientImport}'\n` +
    `import type { GuardInput, GuardedModel } from '${runtimeImportPath}'\n` +
    `import { createGuard } from '${runtimeImportPath}'\n` +
    `import { SCOPE_MAP, TYPE_MAP, ENUM_MAP, ZOD_CHAINS, GUARD_CONFIG, UNIQUE_MAP, ZOD_DEFAULTS } from '${indexImport}'\n` +
    `import type { ScopeRoot } from '${indexImport}'\n\n` +
    emitGuardModelExtension(dmmf) +
    `\n` +
    `export const guard = createGuard<typeof TYPE_MAP, ScopeRoot, GuardModelExtension>({\n` +
    `  scopeMap: SCOPE_MAP,\n` +
    `  typeMap: TYPE_MAP,\n` +
    `  enumMap: ENUM_MAP,\n` +
    `  zodChains: ZOD_CHAINS,\n` +
    `  guardConfig: GUARD_CONFIG,\n` +
    `  uniqueMap: UNIQUE_MAP,\n` +
    `  zodDefaults: ZOD_DEFAULTS,\n` +
    `})\n`
  )
}