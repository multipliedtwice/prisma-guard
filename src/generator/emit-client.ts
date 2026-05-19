import type { DMMF } from '@prisma/generator-helper'

export function emitClient(_dmmf: DMMF.Document, prismaClientImport: string): string {
  return (
    `import type { PrismaClient } from '${prismaClientImport}'\n` +
    `import type { GuardInput, GuardedModel } from 'prisma-guard'\n` +
    `import { createGuard } from 'prisma-guard'\n` +
    `import { SCOPE_MAP, TYPE_MAP, ENUM_MAP, ZOD_CHAINS, GUARD_CONFIG, UNIQUE_MAP, ZOD_DEFAULTS } from './index'\n` +
    `import type { ScopeRoot } from './index'\n\n` +
    `interface GuardModelExtension {\n` +
    `  $allModels: {\n` +
    `    guard<TDelegate>(this: TDelegate, input: GuardInput, caller?: string): GuardedModel<TDelegate>\n` +
    `  }\n` +
    `}\n\n` +
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