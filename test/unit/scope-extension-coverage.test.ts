import { describe, it, expect } from 'vitest'
import { createScopeExtension } from '../../src/runtime/scope-extension.js'
import { PolicyError, ShapeError } from '../../src/shared/errors.js'
import type { ScopeMap, GuardGeneratedConfig } from '../../src/shared/types.js'

const SCOPE_MAP: ScopeMap = {
  Post: [{ fk: 'userId', root: 'User', relationName: 'author' }],
}

/**
 * The arguments these cases read, typed rather than `any`.
 *
 * `any` is what the extension's own signature uses, and it is the one type that
 * cannot fail when the extension stops putting a value where a case expects it —
 * which is exactly what these assertions are for. The shape below carries only
 * the fields read here; anything else the extension passes through is
 * irrelevant to them.
 */
type ScopedArgs = {
  data?: Record<string, unknown>
  where?: Record<string, unknown>
  select?: Record<string, unknown>
  include?: Record<string, unknown>
}

type AllOperations = (params: {
  model: string | undefined
  operation: string
  args: ScopedArgs
  query: (args: ScopedArgs) => Promise<ScopedArgs | ScopedArgs[]>
}) => Promise<ScopedArgs | ScopedArgs[]>

function makeExtension(
  ctx: () => Partial<Record<string, string | number | bigint>>,
  config: GuardGeneratedConfig = { onMissingScopeContext: 'error', findUniqueMode: 'verify' },
): AllOperations {
  const ext = createScopeExtension(SCOPE_MAP, ctx, config)
  return ext.query.$allOperations as AllOperations
}

describe('scope-extension coverage: validateScopeValue', () => {
  it('throws PolicyError for NaN scope value', () => {
    const handler = makeExtension(() => ({ User: NaN }))
    expect(() =>
      handler({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: async () => [],
      }),
    ).toThrow(PolicyError)
  })

  it('throws PolicyError for Infinity scope value', () => {
    const handler = makeExtension(() => ({ User: Infinity }))
    expect(() =>
      handler({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: async () => [],
      }),
    ).toThrow(PolicyError)
  })

  it('throws PolicyError for -Infinity scope value', () => {
    const handler = makeExtension(() => ({ User: -Infinity }))
    expect(() =>
      handler({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: async () => [],
      }),
    ).toThrow(PolicyError)
  })

  it('throws PolicyError for a non-primitive (object) scope value', () => {
    const handler = makeExtension(() => ({ User: {} as unknown as string }))
    expect(() =>
      handler({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: async () => [],
      }),
    ).toThrow(PolicyError)
  })
})

describe('scope-extension coverage: onMissingScopeContext boundary', () => {
  it('fails closed on reads when the config field is absent', () => {
    const handler = makeExtension(
      () => ({}),
      { findUniqueMode: 'verify' } as GuardGeneratedConfig,
    )
    expect(() =>
      handler({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: async () => [],
      }),
    ).toThrow(PolicyError)
  })

  it('rejects an invalid onMissingScopeContext value at construction', () => {
    expect(() =>
      makeExtension(() => ({ User: 'u1' }), {
        onMissingScopeContext: 'bogus',
        findUniqueMode: 'verify',
      } as unknown as GuardGeneratedConfig),
    ).toThrow(ShapeError)
  })
})

describe('scope-extension coverage: handleFindUnique edge cases', () => {
  it('returns null when findUnique returns null', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    const result = await handler({
      model: 'Post',
      operation: 'findUnique',
      args: { where: { id: '1' } },
      query: async () => null,
    })
    expect(result).toBeNull()
  })

  it('injects FK into select and cleans up after verification', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    const queriedArgs: ScopedArgs[] = []
    const result = await handler({
      model: 'Post',
      operation: 'findUnique',
      args: { where: { id: '1' }, select: { id: true, title: true } },
      query: async (args: ScopedArgs) => {
        queriedArgs.push(args)
        return { id: '1', title: 'Test', userId: 'u1' }
      },
    })
    expect(queriedArgs[0].select.userId).toBe(true)
    expect(result.userId).toBeUndefined()
    expect(result.id).toBe('1')
    expect(result.title).toBe('Test')
  })

  it('returns null when FK does not match scope (findUnique)', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    const result = await handler({
      model: 'Post',
      operation: 'findUnique',
      args: { where: { id: '1' } },
      query: async () => ({ id: '1', userId: 'other-user' }),
    })
    expect(result).toBeNull()
  })

  it('throws PolicyError when FK does not match scope (findUniqueOrThrow)', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    await expect(
      handler({
        model: 'Post',
        operation: 'findUniqueOrThrow',
        args: { where: { id: '1' } },
        query: async () => ({ id: '1', userId: 'other-user' }),
      }),
    ).rejects.toThrow(PolicyError)
  })

  it('runs verification query when FK missing from result', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    let callCount = 0
    const result = await handler({
      model: 'Post',
      operation: 'findUnique',
      args: { where: { id: '1' } },
      query: async (args: ScopedArgs) => {
        callCount++
        if (callCount === 1) return { id: '1', title: 'Test' }
        return { userId: 'u1' }
      },
    })
    expect(callCount).toBe(2)
    expect(result).toEqual({ id: '1', title: 'Test' })
  })

  it('throws ShapeError when verification query returns null', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    let callCount = 0
    await expect(
      handler({
        model: 'Post',
        operation: 'findUnique',
        args: { where: { id: '1' } },
        query: async () => {
          callCount++
          if (callCount === 1) return { id: '1', title: 'Test' }
          return null
        },
      }),
    ).rejects.toThrow(PolicyError)
  })

  it('throws ShapeError when verification query throws', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    let callCount = 0
    await expect(
      handler({
        model: 'Post',
        operation: 'findUnique',
        args: { where: { id: '1' } },
        query: async () => {
          callCount++
          if (callCount === 1) return { id: '1', title: 'Test' }
          throw new Error('db connection lost')
        },
      }),
    ).rejects.toThrow(PolicyError)
  })

  it('throws PolicyError when FK not in verification result', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    let callCount = 0
    await expect(
      handler({
        model: 'Post',
        operation: 'findUnique',
        args: { where: { id: '1' } },
        query: async () => {
          callCount++
          if (callCount === 1) return { id: '1', title: 'Test' }
          return { id: '1' }
        },
      }),
    ).rejects.toThrow(PolicyError)
  })

  it('throws PolicyError when where is not valid for verification', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    await expect(
      handler({
        model: 'Post',
        operation: 'findUnique',
        args: { where: null },
        query: async () => ({ id: '1', title: 'Test' }),
      }),
    ).rejects.toThrow(PolicyError)
  })
})

describe('scope-extension coverage: unknown operation', () => {
  it('throws ShapeError for unknown operation on scoped model', () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    expect(() =>
      handler({
        model: 'Post',
        operation: 'someNewOp',
        args: {},
        query: async () => ({}),
      }),
    ).toThrow(ShapeError)
    expect(() =>
      handler({
        model: 'Post',
        operation: 'someNewOp',
        args: {},
        query: async () => ({}),
      }),
    ).toThrow(/Unknown operation/)
  })
})

describe('scope-extension coverage: passthrough for non-scoped models', () => {
  it('passes through for models not in scope map', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    const result = await handler({
      model: 'Comment',
      operation: 'findMany',
      args: { where: { text: 'hello' } },
      query: async (args: ScopedArgs) => args,
    })
    expect(result).toEqual({ where: { text: 'hello' } })
  })

  it('passes through when model is undefined', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    const result = await handler({
      model: undefined,
      operation: 'findMany',
      args: {},
      query: async (args: ScopedArgs) => args,
    })
    expect(result).toEqual({})
  })
})
