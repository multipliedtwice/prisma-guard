import pkg from '@prisma/generator-helper'
const { generatorHandler } = pkg
import type { DMMF } from '@prisma/generator-helper'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { emitScopeMap } from './emit-scope-map.js'
import { emitZodChains } from './emit-zod-chains.js'
import { emitTypeMap } from './emit-type-map.js'
import { emitClient } from './emit-client.js'

const VALID_ON_INVALID_ZOD = new Set<'error' | 'warn'>(['error', 'warn'])
const VALID_ON_AMBIGUOUS_SCOPE = new Set<'error' | 'warn' | 'ignore'>(['error', 'warn', 'ignore'])
const VALID_ON_MISSING_SCOPE_CONTEXT = new Set<'error' | 'warn' | 'ignore'>(['error', 'warn', 'ignore'])
const VALID_FIND_UNIQUE_MODE = new Set<'verify' | 'reject'>(['verify', 'reject'])
const VALID_ON_SCOPE_RELATION_WRITE = new Set<'error' | 'warn' | 'strip'>(['error', 'warn', 'strip'])

function validateConfigEnum<T extends string>(
  name: string,
  value: string,
  allowed: Set<T>,
): T {
  if (!allowed.has(value as T)) {
    throw new Error(
      `prisma-guard: Invalid generator config "${name}": "${value}". Allowed values: ${[...allowed].join(', ')}`,
    )
  }
  return value as T
}

generatorHandler({
  onManifest() {
    return {
      prettyName: 'Prisma Guard',
      defaultOutput: 'generated/guard',
    }
  },

  async onGenerate(options) {
    const output = options.generator.output?.value
    if (!output) throw new Error('prisma-guard: No output directory specified')

    const config = options.generator.config ?? {}
    const onInvalidZod = validateConfigEnum('onInvalidZod', (config.onInvalidZod as string) ?? 'error', VALID_ON_INVALID_ZOD)
    const onAmbiguousScope = validateConfigEnum('onAmbiguousScope', (config.onAmbiguousScope as string) ?? 'error', VALID_ON_AMBIGUOUS_SCOPE)
    const onMissingScopeContext = validateConfigEnum('onMissingScopeContext', (config.onMissingScopeContext as string) ?? 'error', VALID_ON_MISSING_SCOPE_CONTEXT)
    const findUniqueMode = validateConfigEnum('findUniqueMode', (config.findUniqueMode as string) ?? 'reject', VALID_FIND_UNIQUE_MODE)
    const onScopeRelationWrite = validateConfigEnum('onScopeRelationWrite', (config.onScopeRelationWrite as string) ?? 'error', VALID_ON_SCOPE_RELATION_WRITE)

    const dmmf = options.dmmf

    const parts: string[] = []

    parts.push(
      `export const GUARD_CONFIG = {\n` +
      `  onMissingScopeContext: ${JSON.stringify(onMissingScopeContext)},\n` +
      `  findUniqueMode: ${JSON.stringify(findUniqueMode)},\n` +
      `  onScopeRelationWrite: ${JSON.stringify(onScopeRelationWrite)},\n` +
      `} as const\n`,
    )

    const { source: scopeSource } = emitScopeMap(dmmf, onAmbiguousScope)
    parts.push(scopeSource)

    const typeMapSource = emitTypeMap(dmmf)
    parts.push(typeMapSource)

    const { source: zodChainsSource } = emitZodChains(dmmf, onInvalidZod)
    parts.push(zodChainsSource)

    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'index.ts'), parts.join('\n'), 'utf-8')

    const clientSource = emitClient(dmmf)
    writeFileSync(join(output, 'client.ts'), clientSource, 'utf-8')
  },
})