import { z } from 'zod'
import type { FieldMeta, EnumMap } from '../shared/types.js'
import { createBaseType } from './zod-type-map.js'
import {
  wrapWithInputCoercion,
  type ScalarBaseMap,
} from '../shared/scalar-base.js'

export function buildDirectScalarSchema(
  fieldMeta: FieldMeta,
  enumMap: EnumMap,
  scalarBase: ScalarBaseMap,
): z.ZodTypeAny {
  const base = createBaseType(fieldMeta, enumMap, scalarBase)

  if (
    !fieldMeta.isEnum &&
    !fieldMeta.isRelation &&
    !fieldMeta.isUnsupported
  ) {
    return wrapWithInputCoercion(fieldMeta.type, fieldMeta.isList, base)
  }

  return base
}