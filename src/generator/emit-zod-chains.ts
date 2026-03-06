import type { DMMF } from '@prisma/generator-helper'
import { validateDirective } from './validate-directive.js'

function findZodInDoc(documentation: string): string[] {
  return documentation.split('\n').filter(line => {
    const trimmed = line.trim()
    return /(?:^|\s)@zod(?:\s|$|\.)/.test(trimmed)
  })
}

export function emitZodChains(
  dmmf: DMMF.Document,
  onInvalidZod: 'error' | 'warn',
): { source: string; hasChains: boolean } {
  const modelChains: Record<string, Record<string, string>> = {}

  for (const model of dmmf.datamodel.models) {
    for (const field of model.fields) {
      if (!field.documentation) continue

      const zodLines = findZodInDoc(field.documentation)

      if (zodLines.length === 0) continue
      if (zodLines.length > 1) {
        const msg = `prisma-guard: Multiple @zod directives on ${model.name}.${field.name}. Only one @zod per field allowed.`
        if (onInvalidZod === 'error') {
          throw new Error(msg)
        }
        console.warn(msg)
        continue
      }

      const line = zodLines[0]
      const idx = line.indexOf('@zod')
      const chainStr = line.slice(idx + 4).trim()

      if (chainStr.length === 0) {
        const msg = `prisma-guard: Empty @zod directive on ${model.name}.${field.name}. Add a method chain (e.g. @zod .min(1)) or remove the directive.`
        if (onInvalidZod === 'error') {
          throw new Error(msg)
        }
        console.warn(msg)
        continue
      }

      const result = validateDirective(chainStr)
      if (!result.valid) {
        const msg = `prisma-guard: Invalid @zod directive on ${model.name}.${field.name}: ${result.reason}`
        if (onInvalidZod === 'error') {
          throw new Error(msg)
        }
        console.warn(msg)
        continue
      }

      if (!modelChains[model.name]) modelChains[model.name] = {}
      modelChains[model.name][field.name] = chainStr
    }
  }

  const hasChains = Object.keys(modelChains).length > 0

  if (!hasChains) {
    return { source: 'export const ZOD_CHAINS = {}\n', hasChains: false }
  }

  const entries = Object.entries(modelChains)
    .map(([model, fields]) => {
      const fieldEntries = Object.entries(fields)
        .map(([field, chain]) => `    ${JSON.stringify(field)}: (base: any) => base${chain},`)
        .join('\n')
      return `  ${JSON.stringify(model)}: {\n${fieldEntries}\n  },`
    })
    .join('\n')

  return {
    source: `export const ZOD_CHAINS = {\n${entries}\n}\n`,
    hasChains: true,
  }
}