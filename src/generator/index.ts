import pkg from '@prisma/generator-helper'
const { generatorHandler } = pkg
import type { DMMF } from '@prisma/generator-helper'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { z } from 'zod'
import { emitClient } from './emit-client.js'
import { emitScopeMap } from './emit-scope-map.js'
import { emitTypeMap } from './emit-type-map.js'
import { emitTypedShapes } from './emit-typed-shapes.js'
import { emitZodChains, emitZodDefaults } from './emit-zod-chains.js'
import { emitGuardConfig } from './emit-guard-config.js'
import { resolveImportStyle } from './import-style.js'

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
      emitGuardConfig({
        onMissingScopeContext: cfg.onMissingScopeContext,
        findUniqueMode: cfg.findUniqueMode,
        onScopeRelationWrite: cfg.onScopeRelationWrite,
        strictDecimal: cfg.strictDecimal,
        enforceProjection: cfg.enforceProjection,
      }),
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

    const clientSource = emitClient(importStyle, cfg.runtimeImportPath)
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