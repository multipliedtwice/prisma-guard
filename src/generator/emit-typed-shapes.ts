import type { DMMF } from '@prisma/generator-helper'
import { OPERATION_SHAPE_KEYS } from '../shared/operation-shape-keys.js'

const OPERATIONS = Object.keys(OPERATION_SHAPE_KEYS) as Array<
  keyof typeof OPERATION_SHAPE_KEYS
>

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function emitTypedShapes(
  dmmf: DMMF.Document,
  depth: 0 | 1 | 2 | 3,
): string {
  const header =
    `import type { TYPE_MAP, UNIQUE_MAP } from './index'\n` +
    `import type {\n` +
    `  TypedGuardShape,\n` +
    `  OperationShape,\n` +
    `  ShapeInput,\n` +
    `  TypedProjection,\n` +
    `  TypedInclude,\n` +
    `  TypedCountSelect,\n` +
    `} from 'prisma-guard'\n\n` +
    `type TM = typeof TYPE_MAP\n` +
    `type UM = typeof UNIQUE_MAP\n\n`

  const blocks = dmmf.datamodel.models
    .map((model) => {
      const m = model.name

      const projAlias =
        `export type ${m}Select = ` +
        `TypedProjection<TM, '${m}', ${depth}, UM>\n` +
        `export type ${m}Projection = ${m}Select\n` +
        `export type ${m}Include = ` +
        `TypedInclude<TM, '${m}', ${depth}, UM>\n` +
        `export type ${m}CountSelect = ` +
        `TypedCountSelect<TM, '${m}'>\n`

      const guardAlias =
        `export type ${m}GuardShape = ` +
        `TypedGuardShape<TM, '${m}', ${depth}, UM>\n`

      const opAliases = OPERATIONS.map((op) => {
        const c = cap(op)

        return (
          `export type ${m}${c}Shape = ` +
          `OperationShape<TM, '${m}', '${op}', ${depth}, UM>\n` +
          `export type ${m}${c}ShapeInput<TCtx = unknown> = ` +
          `ShapeInput<${m}${c}Shape, TCtx>\n`
        )
      }).join('')

      return projAlias + guardAlias + opAliases
    })
    .join('\n')

  return header + blocks
}