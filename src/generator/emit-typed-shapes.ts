import type { DMMF } from '@prisma/generator-helper'
import { OPERATION_SHAPE_KEYS } from '../shared/operation-shape-keys.js'
import { withImportStyle, type ImportStyle } from './import-style.js'

const OPERATIONS = Object.keys(OPERATION_SHAPE_KEYS) as Array<
  keyof typeof OPERATION_SHAPE_KEYS
>

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function emitTypedShapes(
  dmmf: DMMF.Document,
  depth: 0 | 1 | 2 | 3,
  importStyle: ImportStyle,
  runtimeImportPath: string,
): string {
  const indexImport = withImportStyle('./index', importStyle)

  // Imported helpers are prefixed with "_" so they can never collide with the
  // emitted `${model}Projection` / `${model}GuardShape` / ... aliases. Prisma
  // model names must start with a letter, so a leading underscore is safe.
  const header = `import type { TYPE_MAP, UNIQUE_MAP } from ${JSON.stringify(indexImport)}
import type {
  TypedGuardShape as _TypedGuardShape,
  OperationShape as _OperationShape,
  ShapeInput as _ShapeInput,
  TypedProjection as _TypedProjection,
  TypedInclude as _TypedInclude,
  TypedCountSelect as _TypedCountSelect,
} from ${JSON.stringify(runtimeImportPath)}

type TM = typeof TYPE_MAP
type UM = typeof UNIQUE_MAP

`

  const blocks = dmmf.datamodel.models
    .map((model) => {
      const m = model.name

      const projAlias = `export type ${m}Select = _TypedProjection<TM, '${m}', ${depth}, UM>
export type ${m}Projection = ${m}Select
export type ${m}Include = _TypedInclude<TM, '${m}', ${depth}, UM>
export type ${m}CountSelect = _TypedCountSelect<TM, '${m}'>
`

      const guardAlias = `export type ${m}GuardShape = _TypedGuardShape<TM, '${m}', ${depth}, UM>
`

      const opAliases = OPERATIONS.map((op) => {
        const c = cap(op)
        return `export type ${m}${c}Shape = _OperationShape<TM, '${m}', '${op}', ${depth}, UM>
export type ${m}${c}ShapeInput<TCtx = unknown> = _ShapeInput<${m}${c}Shape, TCtx>
`
      }).join('')

      return projAlias + guardAlias + opAliases
    })
    .join('\n')

  return header + blocks
}