export interface GuardConfigInput {
  onMissingScopeContext: string
  findUniqueMode: string
  onScopeRelationWrite: string
  strictDecimal: boolean
  enforceProjection: boolean
}

export function emitGuardConfig(cfg: GuardConfigInput): string {
  return `export const GUARD_CONFIG = {
  onMissingScopeContext: ${JSON.stringify(cfg.onMissingScopeContext)},
  findUniqueMode: ${JSON.stringify(cfg.findUniqueMode)},
  onScopeRelationWrite: ${JSON.stringify(cfg.onScopeRelationWrite)},
  strictDecimal: ${JSON.stringify(cfg.strictDecimal)},
  enforceProjection: ${JSON.stringify(cfg.enforceProjection)},
} as const
`
}