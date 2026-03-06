import pkg from '@prisma/generator-helper'
const { generatorHandler } = pkg
import type { DMMF } from '@prisma/generator-helper'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { emitScopeMap } from './emit-scope-map.js'
import { emitZodChains } from './emit-zod-chains.js'
import { emitTypeMap } from './emit-type-map.js'

const VALID_ON_INVALID_ZOD = new Set(['error', 'warn'])
const VALID_ON_AMBIGUOUS_SCOPE = new Set(['error', 'warn', 'ignore'])
const VALID_ON_MISSING_SCOPE_CONTEXT = new Set(['error', 'warn', 'ignore'])
const VALID_FIND_UNIQUE_MODE = new Set(['verify', 'reject'])

function validateConfigEnum(
  name: string,
  value: string,
  allowed: Set<string>,
): void {
  if (!allowed.has(value)) {
    throw new Error(
      `prisma-guard: Invalid generator config "${name}": "${value}". Allowed values: ${[...allowed].join(', ')}`,
    )
  }
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
    const onInvalidZod = (config.onInvalidZod as string) ?? 'error'
    const onAmbiguousScope = (config.onAmbiguousScope as string) ?? 'error'
    const onMissingScopeContext = (config.onMissingScopeContext as string) ?? 'error'
    const findUniqueMode = (config.findUniqueMode as string) ?? 'verify'

    validateConfigEnum('onInvalidZod', onInvalidZod, VALID_ON_INVALID_ZOD)
    validateConfigEnum('onAmbiguousScope', onAmbiguousScope, VALID_ON_AMBIGUOUS_SCOPE)
    validateConfigEnum('onMissingScopeContext', onMissingScopeContext, VALID_ON_MISSING_SCOPE_CONTEXT)
    validateConfigEnum('findUniqueMode', findUniqueMode, VALID_FIND_UNIQUE_MODE)

    const dmmf = options.dmmf

    const parts: string[] = []

    parts.push(
      `export const GUARD_CONFIG = {\n` +
      `  onMissingScopeContext: ${JSON.stringify(onMissingScopeContext)},\n` +
      `  findUniqueMode: ${JSON.stringify(findUniqueMode)},\n` +
      `} as const\n`,
    )

    const { source: scopeSource } = emitScopeMap(dmmf, onAmbiguousScope as 'error' | 'warn' | 'ignore')
    parts.push(scopeSource)

    const typeMapSource = emitTypeMap(dmmf)
    parts.push(typeMapSource)

    const { source: zodChainsSource } = emitZodChains(dmmf, onInvalidZod as 'error' | 'warn')
    parts.push(zodChainsSource)

    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'index.ts'), parts.join('\n'), 'utf-8')
  },
})