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
const VALID_BOOLEAN_CONFIG = new Set(['true', 'false'])

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

function validateBooleanConfig(name: string, raw: string | undefined, fallback: boolean): boolean {
  const value = raw ?? (fallback ? 'true' : 'false')
  if (!VALID_BOOLEAN_CONFIG.has(value)) {
    throw new Error(
      `prisma-guard: Invalid generator config "${name}": "${value}". Allowed values: true, false`,
    )
  }
  return value === 'true'
}

function emitZodDefaults(defaults: Record<string, string[]>): string {
  const entries = Object.entries(defaults)
  if (entries.length === 0) {
    return `export const ZOD_DEFAULTS: Record<string, readonly string[]> = {}\n`
  }
  const mapEntries = entries
    .map(([model, fields]) => {
      const fieldsStr = fields.map(f => JSON.stringify(f)).join(', ')
      return `  ${JSON.stringify(model)}: [${fieldsStr}],`
    })
    .join('\n')
  return `export const ZOD_DEFAULTS: Record<string, readonly string[]> = {\n${mapEntries}\n}\n`
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
    const strictDecimal = validateBooleanConfig('strictDecimal', config.strictDecimal as string | undefined, false)
    const enforceProjection = validateBooleanConfig('enforceProjection', config.enforceProjection as string | undefined, false)

    const dmmf = options.dmmf

    const parts: string[] = []

    parts.push(
      `export const GUARD_CONFIG = {\n` +
      `  onMissingScopeContext: ${JSON.stringify(onMissingScopeContext)},\n` +
      `  findUniqueMode: ${JSON.stringify(findUniqueMode)},\n` +
      `  onScopeRelationWrite: ${JSON.stringify(onScopeRelationWrite)},\n` +
      `  strictDecimal: ${JSON.stringify(strictDecimal)},\n` +
      `  enforceProjection: ${JSON.stringify(enforceProjection)},\n` +
      `} as const\n`,
    )

    const { source: scopeSource } = emitScopeMap(dmmf, onAmbiguousScope)
    parts.push(scopeSource)

    const typeMapSource = emitTypeMap(dmmf)
    parts.push(typeMapSource)

    const { source: zodChainsSource, defaults } = emitZodChains(dmmf, onInvalidZod)
    parts.push(zodChainsSource)

    parts.push(emitZodDefaults(defaults))

    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'index.ts'), parts.join('\n'), 'utf-8')

    const clientSource = emitClient(dmmf)
    writeFileSync(join(output, 'client.ts'), clientSource, 'utf-8')
  },
})