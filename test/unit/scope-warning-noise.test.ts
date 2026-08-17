import { describe, it, expect } from 'vitest'
import { createScopeExtension } from '../../src/runtime/scope-extension.js'
import type { ScopeMap, GuardGeneratedConfig, GuardLogger } from '../../src/shared/types.js'

/**
 * When the scope extension should say something, and when it should not.
 *
 * A caller that ALSO writes the scope column is not making a mistake — it is
 * writing the predicate twice, which is what defence in depth looks like in a
 * codebase that had explicit `where` clauses before it had this extension.
 * Warning on each of those turns the logger into noise, and a logger nobody
 * reads is worse than no logger: the disagreement that matters arrives in the
 * same stream as hundreds that do not.
 *
 * The comparison is `scopeValuesEqual`, so a scope that arrives as `1n` from the
 * context and `1` from the caller is agreement, not a conflict.
 */

const SCOPE_MAP: ScopeMap = {
  Post: [{ fk: 'tenantId', root: 'Tenant', relationName: 'tenant' }],
}

const CONFIG: GuardGeneratedConfig = {
  onMissingScopeContext: 'error',
  findUniqueMode: 'reject',
  onScopeRelationWrite: 'error',
}

/**
 * The arguments an operation carries, as much of them as these tests read.
 *
 * `any` would have done, and it is what the extension's own signature uses —
 * but every assertion below is about a VALUE the extension put in `data` or
 * `where`, and `any` is the one type that cannot fail when the extension stops
 * putting it there.
 */
type ScopedArgs = {
  data?: Record<string, unknown>
  where?: Record<string, unknown>
}

type AllOperations = (params: {
  model: string | undefined
  operation: string
  args: ScopedArgs
  query: (args: ScopedArgs) => Promise<ScopedArgs>
}) => Promise<ScopedArgs>

function harness(scope: string | number | bigint, config: GuardGeneratedConfig = CONFIG) {
  const warnings: string[] = []
  const logger: GuardLogger = { warn: (msg) => warnings.push(msg) }
  const ext = createScopeExtension(SCOPE_MAP, () => ({ Tenant: scope }), config, logger)
  const run: AllOperations = ext.query.$allOperations

  return {
    warnings,
    call(operation: string, args: ScopedArgs): Promise<ScopedArgs> {
      return run({
        model: 'Post',
        operation,
        args,
        query: async (a) => a,
      })
    },
  }
}

describe('an explicit scope column that AGREES with the context is silent', () => {
  it('says nothing when a create repeats the scope value', async () => {
    const h = harness('tenant-1')

    const args = await h.call('create', { data: { title: 'x', tenantId: 'tenant-1' } })

    expect(h.warnings).toEqual([])
    expect(args.data?.tenantId).toBe('tenant-1')
  })

  it('says nothing when an update repeats it', async () => {
    const h = harness('tenant-1')

    await h.call('updateMany', { where: { id: 1 }, data: { tenantId: 'tenant-1' } })

    expect(h.warnings).toEqual([])
  })

  it('says nothing when a unique where repeats it', async () => {
    const h = harness('tenant-1')

    await h.call('update', { where: { id: 1, tenantId: 'tenant-1' }, data: { title: 'x' } })

    expect(h.warnings).toEqual([])
  })

  it('treats a bigint context and a number argument as the same scope', async () => {
    // The case strict inequality gets wrong: `1n !== 1`, but they are one tenant.
    const h = harness(1n)

    await h.call('create', { data: { title: 'x', tenantId: 1 } })
    await h.call('update', { where: { id: 9, tenantId: 1 }, data: { title: 'x' } })

    expect(h.warnings).toEqual([])
  })

  it('treats a number context and a bigint argument as the same scope', async () => {
    const h = harness(1)

    await h.call('create', { data: { title: 'x', tenantId: 1n } })

    expect(h.warnings).toEqual([])
  })
})

describe('an explicit scope column that DISAGREES is still reported', () => {
  it('warns when a create names another tenant, and writes the authorised one', async () => {
    const h = harness('tenant-1')

    const args = await h.call('create', { data: { title: 'x', tenantId: 'tenant-2' } })

    expect(h.warnings.join(' ')).toMatch(/overridden by scope context/)
    expect(args.data?.tenantId).toBe('tenant-1')
  })

  it('warns when a unique where names another tenant', async () => {
    const h = harness('tenant-1')

    await h.call('update', { where: { id: 1, tenantId: 'tenant-2' }, data: { title: 'x' } })

    expect(h.warnings.join(' ')).toMatch(/Stripped in favor of scope context/)
  })

  it('warns on a numerically different value, bigint or not', async () => {
    const h = harness(1n)

    await h.call('create', { data: { title: 'x', tenantId: 2 } })

    expect(h.warnings.join(' ')).toMatch(/overridden by scope context/)
  })

  it('warns on a non-integer number against a bigint context, which cannot be the same row', async () => {
    const h = harness(1n)

    await h.call('create', { data: { title: 'x', tenantId: 1.5 } })

    expect(h.warnings.join(' ')).toMatch(/overridden by scope context/)
  })
})

describe('the relation form is refused, not merely reported', () => {
  it('throws rather than warning when the scope relation is written directly', () => {
    const h = harness('tenant-1')

    // Synchronously: `$allOperations` refuses before it returns a promise, so
    // the caller never gets one to await.
    expect(() =>
      h.call('create', { data: { title: 'x', tenant: { connect: { id: 'tenant-2' } } } })
    ).toThrow(/cannot be set directly/)
  })

  it('warns and strips it when configured to warn', async () => {
    const h = harness('tenant-1', { ...CONFIG, onScopeRelationWrite: 'warn' })

    const args = await h.call('create', {
      data: { title: 'x', tenant: { connect: { id: 'tenant-2' } } },
    })

    expect(h.warnings.join(' ')).toMatch(/was removed by scope context/)
    expect(args.data?.tenant).toBeUndefined()
  })
})

describe('a number that cannot name one integer is a DISAGREEMENT, not agreement', () => {
  /**
   * THE COMPARISON DECIDES WHETHER ANYONE IS TOLD.
   *
   * The row filter is never the caller's: a supplied scope column is stripped
   * and the context's predicate is applied, so this is not a leak. What it
   * decides is whether a caller trying to leave its scope is REPORTED — and
   * that report is the only signal such an attempt produces.
   *
   * Past 2^53 a `number` no longer names one integer. The literal
   * `9007199254740993` IS the double `9007199254740992`, so an `isInteger` test
   * calls it equal to tenant `9007199254740992n` and the warning never fires:
   * the one caller worth hearing about is silently reclassified as
   * defence-in-depth. `isSafeInteger` refuses that whole range, so anything
   * ambiguous is reported.
   */
  it('warns when the caller names an unsafe number against a real bigint scope', async () => {
    const h = harness(9007199254740992n)

    await h.call('update', { where: { id: 1, tenantId: 9007199254740993 }, data: { title: 'x' } })

    expect(h.warnings).toHaveLength(1)
    expect(h.warnings[0]).toContain('tenantId')
  })

  it('warns at the safe-range boundary, on either side of the comparison', async () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1

    const fromCaller = harness(BigInt(unsafe))
    await fromCaller.call('update', { where: { id: 1, tenantId: unsafe }, data: {} })
    expect(fromCaller.warnings).toHaveLength(1)

    const fromContext = harness(unsafe)
    await fromContext.call('update', { where: { id: 1, tenantId: BigInt(unsafe) }, data: {} })
    expect(fromContext.warnings).toHaveLength(1)
  })

  it('stays silent for the largest id a number CAN name exactly', async () => {
    // The control: the fix refuses an ambiguous range, not large ids.
    const max = Number.MAX_SAFE_INTEGER
    const h = harness(BigInt(max))

    await h.call('update', { where: { id: 1, tenantId: max }, data: {} })

    expect(h.warnings).toEqual([])
  })
})
