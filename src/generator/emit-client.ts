import type { DMMF } from '@prisma/generator-helper'
import { toDelegateKey } from '../shared/constants.js'

export function emitClient(dmmf: DMMF.Document): string {
  const modelEntries = dmmf.datamodel.models
    .map(model => {
      const key = toDelegateKey(model.name)
      return `    ${key}: {\n      guard(input: GuardInput, caller?: string): GuardedModel<PrismaClient['${key}']>\n    }`
    })
    .join('\n')

  return (
    `import type { PrismaClient } from '@prisma/client'\n` +
    `import type { GuardInput, GuardedModel } from 'prisma-guard'\n` +
    `import { createGuard } from 'prisma-guard'\n` +
    `import { SCOPE_MAP, TYPE_MAP, ENUM_MAP, ZOD_CHAINS, GUARD_CONFIG, UNIQUE_MAP, ZOD_DEFAULTS } from './index'\n` +
    `import type { ScopeRoot } from './index'\n\n` +
    `interface GuardModelExtension {\n${modelEntries}\n}\n\n` +
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