import { withImportStyle, type ImportStyle } from './import-style.js'

// ONE entry, not one per model.
//
// A member per model made this interface grow with the schema, and it rides
// inside Prisma's ExtArgs: a consumer with a large schema re-instantiates it
// through every args comparison and can exhaust TypeScript's
// instantiation-depth budget. That failure is reported against whatever file
// happens to tip it over rather than against this package.
//
// Model specificity is preserved by inferring the receiver: Prisma distributes
// an $allModels method to every model and binds the model's own context as
// `this`, so `GuardedModel<T>` resolves per call site. Nothing here is widened
// to a union or to `any` — guard-model-types.e2e.test.ts pins that.
function emitGuardModelExtension(): string {
  return `interface GuardModelExtension {
  $allModels: {
    guard<T>(this: T, input: GuardInput, caller?: string): GuardedModel<T>
  }
}
`
}

// Takes neither the DMMF nor the Prisma client import: the compact interface
// infers its receiver rather than indexing PrismaClient per model, so the
// emitted file names neither the models nor the client.
export function emitClient(
  importStyle: ImportStyle,
  runtimeImportPath: string,
): string {
  const indexImport = withImportStyle('./index', importStyle)

  const runtimeLit = JSON.stringify(runtimeImportPath)
  const indexLit = JSON.stringify(indexImport)

  return `import type { GuardInput, GuardedModel } from ${runtimeLit}
import { createGuard } from ${runtimeLit}
import { SCOPE_MAP, TYPE_MAP, ENUM_MAP, ZOD_CHAINS, GUARD_CONFIG, UNIQUE_MAP, ZOD_DEFAULTS } from ${indexLit}
import type { ScopeRoot } from ${indexLit}

${emitGuardModelExtension()}
export const guard = createGuard<typeof TYPE_MAP, ScopeRoot, GuardModelExtension>({
  scopeMap: SCOPE_MAP,
  typeMap: TYPE_MAP,
  enumMap: ENUM_MAP,
  zodChains: ZOD_CHAINS,
  guardConfig: GUARD_CONFIG,
  uniqueMap: UNIQUE_MAP,
  zodDefaults: ZOD_DEFAULTS,
})
`
}