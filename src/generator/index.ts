import pkg from '@prisma/generator-helper'
const { generatorHandler } = pkg
import type { DMMF, GeneratorOptions } from '@prisma/generator-helper'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { relative } from 'path'
import { z } from 'zod'
import { emitClient } from './emit-client.js'
import { emitScopeMap } from './emit-scope-map.js'
import { emitTypeMap } from './emit-type-map.js'
import { emitTypedShapes } from './emit-typed-shapes.js'
import { emitZodChains } from './emit-zod-chains.js'
import {
  resolveImportStyle,
  type PrismaClientKind,
} from './import-style.js'

const booleanConfig = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')

const configSchema = z.object({
  onInvalidZod: z.enum(['error', 'warn']).default('error'),
  onAmbiguousScope: z.enum(['error', 'warn', 'ignore']).default('error'),
  onMissingScopeContext: z.enum(['error', 'warn', 'ignore']).default('error'),
  findUniqueMode: z.enum(['verify', 'reject']).default('reject'),
  onScopeRelationWrite: z.enum(['error', 'warn', 'strip']).default('error'),
  strictDecimal: booleanConfig.default(false),
  enforceProjection: booleanConfig.default(false),
  typedGuardShapes: booleanConfig.default(true),
  typedGuardRelationDepth: z
    .enum(['0', '1', '2', '3'])
    .default('1')
    .transform((v) => Number(v) as 0 | 1 | 2 | 3),
  importStyle: z.enum(['auto', 'none', 'js', 'ts']).default('auto'),
  runtimeImportPath: z
    .string()
    .trim()
    .min(1, 'runtimeImportPath must be a non-empty string')
    .default('prisma-guard'),
})

type ResolvedConfig = z.infer<typeof configSchema>

function parseGeneratorConfig(raw: Record<string, unknown>): ResolvedConfig {
  const result = configSchema.safeParse(raw)
  if (result.success) return result.data

  const issues = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `"${path}": ${issue.message}`
    })
    .join('; ')

  throw new Error(`prisma-guard: Invalid generator config: ${issues}`)
}

function emitZodDefaults(defaults: Record<string, string[]>): string {
  const entries = Object.entries(defaults)

  if (entries.length === 0) {
    return `export const ZOD_DEFAULTS: Record<string, readonly string[]> = {}\n`
  }

  const mapEntries = entries
    .map(([model, fields]) => {
      const fieldsStr = fields.map((field) => JSON.stringify(field)).join(', ')
      return `  ${JSON.stringify(model)}: [${fieldsStr}],`
    })
    .join('\n')

  return `export const ZOD_DEFAULTS: Record<string, readonly string[]> = {\n${mapEntries}\n}\n`
}

function getProviderValue(provider: unknown): string {
  if (typeof provider === 'string') return provider

  if (provider && typeof provider === 'object' && 'value' in provider) {
    const value = (provider as { value?: unknown }).value
    if (typeof value === 'string') return value
  }

  return ''
}

function classifyPrismaProvider(provider: unknown): 'prisma-client-js' | 'prisma-client' | null {
  const value = getProviderValue(provider)

  if (value === 'prisma-client-js' || value.endsWith('/prisma-client-js')) {
    return 'prisma-client-js'
  }

  if (value === 'prisma-client' || value.endsWith('/prisma-client')) {
    return 'prisma-client'
  }

  return null
}

function normalizeImportPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return '@prisma/client'
  }
  if (normalized.startsWith('.')) return normalized
  return `./${normalized}`
}

function resolvePrismaClientImport(
  options: GeneratorOptions,
  guardOutput: string,
): { path: string; kind: PrismaClientKind } {
  let matched: { provider: 'prisma-client-js' | 'prisma-client'; output: string } | null = null

  for (const generator of options.otherGenerators) {
    const providerKind = classifyPrismaProvider(generator.provider)
    if (!providerKind) continue

    const output = generator.output?.value
    if (!output) continue

    matched = { provider: providerKind, output }
    break
  }

  if (!matched) return { path: '@prisma/client', kind: 'package' }

  const rel = relative(guardOutput, matched.output)
  if (rel.length === 0) return { path: '@prisma/client', kind: 'package' }

  return {
    path: normalizeImportPath(rel),
    kind: matched.provider,
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

    const rawConfig = (options.generator.config ?? {}) as Record<string, unknown>
    const cfg = parseGeneratorConfig(rawConfig)

    const importStyle = resolveImportStyle(output, cfg.importStyle)

    const dmmf: DMMF.Document = options.dmmf
    const parts: string[] = []

    parts.push(
      `export const GUARD_CONFIG = {\n` +
        `  onMissingScopeContext: ${JSON.stringify(cfg.onMissingScopeContext)},\n` +
        `  findUniqueMode: ${JSON.stringify(cfg.findUniqueMode)},\n` +
        `  onScopeRelationWrite: ${JSON.stringify(cfg.onScopeRelationWrite)},\n` +
        `  strictDecimal: ${JSON.stringify(cfg.strictDecimal)},\n` +
        `  enforceProjection: ${JSON.stringify(cfg.enforceProjection)},\n` +
        `} as const\n`,
    )

    const { source: scopeSource } = emitScopeMap(dmmf, cfg.onAmbiguousScope)
    parts.push(scopeSource)

    const typeMapSource = emitTypeMap(dmmf)
    parts.push(typeMapSource)

    const { source: zodChainsSource, defaults } = emitZodChains(dmmf, cfg.onInvalidZod)
    parts.push(zodChainsSource)
    parts.push(emitZodDefaults(defaults))

    mkdirSync(output, { recursive: true })

    writeFileSync(`${output}/index.ts`, parts.join('\n'), 'utf-8')

    const { path: prismaClientImport, kind: prismaClientKind } =
      resolvePrismaClientImport(options, output)
    const clientSource = emitClient(
      dmmf,
      prismaClientImport,
      prismaClientKind,
      importStyle,
      cfg.runtimeImportPath,
    )
    writeFileSync(`${output}/client.ts`, clientSource, 'utf-8')

    const shapesPath = `${output}/shapes.ts`

    if (cfg.typedGuardShapes) {
      writeFileSync(
        shapesPath,
        emitTypedShapes(dmmf, cfg.typedGuardRelationDepth, importStyle, cfg.runtimeImportPath),
        'utf-8',
      )
    } else if (existsSync(shapesPath)) {
      rmSync(shapesPath, { force: true })
    }
  },
})