import { describe, it, expect } from 'vitest'
import { createScopeExtension } from '../../src/runtime/scope-extension.js'
import { PolicyError, ShapeError } from '../../src/shared/errors.js'
import type { ScopeMap, GuardGeneratedConfig } from '../../src/shared/types.js'

const SCOPE_MAP: ScopeMap = {
  Post: [{ fk: 'userId', root: 'User', relationName: 'author' }],
}

function makeExtension(
  ctx: () => Partial<Record<string, string | number | bigint>>,
  config: GuardGeneratedConfig = { onMissingScopeContext: 'error', findUniqueMode: 'verify' },
) {
  const ext = createScopeExtension(SCOPE_MAP, ctx, config)
  return ext.query.$allOperations as (params: {
    model: string | undefined
    operation: string
    args: any
    query: (args: any) => Promise<any>
  }) => Promise<any>
}

describe('scope-extension coverage: validateScopeValue', () => {
  it('throws PolicyError for NaN scope value', () => {
    const handler = makeExtension(() => ({ User: NaN }))
    expect(() =>
      handler({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: async (args: any) => [],
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
        query: async (args: any) => [],
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
        query: async (args: any) => [],
      }),
    ).toThrow(PolicyError)
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
    const queriedArgs: any[] = []
    const result = await handler({
      model: 'Post',
      operation: 'findUnique',
      args: { where: { id: '1' }, select: { id: true, title: true } },
      query: async (args: any) => {
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
      query: async (args: any) => {
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
      query: async (args: any) => args,
    })
    expect(result).toEqual({ where: { text: 'hello' } })
  })

  it('passes through when model is undefined', async () => {
    const handler = makeExtension(() => ({ User: 'u1' }))
    const result = await handler({
      model: undefined,
      operation: 'findMany',
      args: {},
      query: async (args: any) => args,
    })
    expect(result).toEqual({})
  })
})