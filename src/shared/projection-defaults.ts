import type {
  NestedArgs,
  GuardShape,
} from './types.js'
import { isPlainObject } from './utils.js'

export function buildDefaultProjectionInput(
  config: Record<string, true | NestedArgs>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(config)) {
    if (key === '_count') {
      result[key] = buildDefaultCountInput(
        value as true | Record<string, unknown>,
      )
      continue
    }

    if (value === true) {
      result[key] = true
    } else {
      result[key] = buildRelationArgsSkeleton(value)
    }
  }

  return result
}

export const buildDefaultSelectInput = buildDefaultProjectionInput
export const buildDefaultIncludeInput = buildDefaultProjectionInput

export function buildRelationArgsSkeleton(
  config: NestedArgs,
): Record<string, unknown> {
  const skeleton: Record<string, unknown> = {}

  if (config.select) {
    skeleton.select = buildDefaultProjectionInput(config.select)
  }

  if (config.include) {
    skeleton.include = buildDefaultProjectionInput(config.include)
  }

  return skeleton
}

export function buildDefaultCountInput(
  config: true | Record<string, unknown>,
): unknown {
  if (config === true) return true

  if (
    !isPlainObject(config) ||
    !config.select ||
    !isPlainObject(config.select)
  ) {
    return true
  }

  const selectObj = config.select as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const key of Object.keys(selectObj)) {
    result[key] = true
  }

  return { select: result }
}

export function buildDefaultProjectionBody(
  shape: GuardShape,
): Record<string, unknown> {
  if (shape.select) {
    return { select: buildDefaultProjectionInput(shape.select) }
  }

  if (shape.include) {
    return { include: buildDefaultProjectionInput(shape.include) }
  }

  return {}
}