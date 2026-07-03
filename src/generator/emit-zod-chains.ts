import type { DMMF } from '@prisma/generator-helper'
import { z } from 'zod'
import { validateDirective } from './validate-directive.js'
import { SCALAR_BASE } from '../shared/scalar-base.js'

function buildGenerationBase(
  fieldType: string,
  isList: boolean,
  isEnum: boolean,
  enumValues?: readonly string[],
): z.ZodTypeAny | null {
  let base: z.ZodTypeAny

  if (isEnum) {
    const values = enumValues && enumValues.length > 0 ? enumValues : ['__placeholder__']
    base = z.enum(values as [string, ...string[]])
  } else {
    const factory = SCALAR_BASE[fieldType]
    if (!factory) return null
    base = factory()
  }

  if (isList) base = z.array(base)

  return base
}

function verifyChainExecution(
  fieldType: string,
  isList: boolean,
  isEnum: boolean,
  enumValues: readonly string[] | undefined,
  chainStr: string,
): string | null {
  const base = buildGenerationBase(fieldType, isList, isEnum, enumValues)
  if (!base) {
    return `Unsupported field type "${fieldType}" for @zod directive`
  }

  let fn: (base: z.ZodTypeAny) => z.ZodTypeAny
  try {
    fn = new Function('base', `'use strict'; return base${chainStr}`) as (base: z.ZodTypeAny) => z.ZodTypeAny
  } catch (err: any) {
    return `syntax error: ${err.message}`
  }

  try {
    const result = fn(base)
    if (result === null || result === undefined || typeof result !== 'object' || typeof (result as any).parse !== 'function') {
      return 'chain did not produce a valid Zod schema'
    }
  } catch (err: any) {
    return err.message
  }

  return null
}

function findZodInDoc(documentation: string): string[] {
  return documentation.split('\n').filter(line => {
    const trimmed = line.trim()
    return /^@zod(?:\s|$|\.)/.test(trimmed)
  })
}

export function emitZodChains(
  dmmf: DMMF.Document,
  onInvalidZod: 'error' | 'warn',
): { source: string; hasChains: boolean; defaults: Record<string, string[]> } {
  const enumNames = new Set(dmmf.datamodel.enums.map(e => e.name))
  const enumValues: Record<string, readonly string[]> = {}
  for (const e of dmmf.datamodel.enums) {
    enumValues[e.name] = e.values.map(v => v.name)
  }

  const modelChains: Record<string, Record<string, string>> = {}
  const defaults: Record<string, string[]> = {}

  function fail(msg: string): void {
    if (onInvalidZod === 'error') throw new Error(msg)
    console.warn(msg)
  }

  for (const model of dmmf.datamodel.models) {
    for (const field of model.fields) {
      if (!field.documentation) continue

      const zodLines = findZodInDoc(field.documentation)

      if (zodLines.length === 0) continue

      if (zodLines.length > 1) {
        fail(`prisma-guard: Multiple @zod directives on ${model.name}.${field.name}. Only one @zod per field allowed.`)
        continue
      }

      const line = zodLines[0]
      const idx = line.indexOf('@zod')
      const chainStr = line.slice(idx + 4).trim()

      if (chainStr.length === 0) {
        fail(`prisma-guard: Empty @zod directive on ${model.name}.${field.name}. Add a method chain (e.g. @zod .min(1)) or remove the directive.`)
        continue
      }

      const result = validateDirective(chainStr)

      if (result.valid === false) {
        fail(`prisma-guard: Invalid @zod directive on ${model.name}.${field.name}: ${result.reason}`)
        continue
      }

      const isEnum = enumNames.has(field.type)

      const execError = verifyChainExecution(
        field.type,
        field.isList,
        isEnum,
        isEnum ? enumValues[field.type] : undefined,
        chainStr,
      )
      if (execError) {
        fail(`prisma-guard: @zod directive on ${model.name}.${field.name} fails at schema construction: ${execError}`)
        continue
      }

      if (!modelChains[model.name]) modelChains[model.name] = {}
      modelChains[model.name][field.name] = chainStr

      if (result.methods.includes('default') || result.methods.includes('catch')) {
        if (!defaults[model.name]) defaults[model.name] = []
        defaults[model.name].push(field.name)
      }
    }
  }

  const hasChains = Object.keys(modelChains).length > 0

  if (!hasChains) {
    return { source: 'export const ZOD_CHAINS = {}\n', hasChains: false, defaults }
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
    defaults,
  }
}