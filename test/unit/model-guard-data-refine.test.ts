import { describe, it, expect } from 'vitest'
import { createModelGuardExtension } from '../../src/runtime/model-guard.js'
import { ShapeError } from '../../src/shared/errors.js'
import type { TypeMap, EnumMap, ZodChains, ZodDefaults, UniqueMap } from '../../src/shared/types.js'

const typeMap: TypeMap = {
  Item: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false, isUnique: true },
    name: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    count: { type: 'Int', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
}

const enumMap: EnumMap = {}
const zodChains: ZodChains = {}
const zodDefaults: ZodDefaults = {}
const uniqueMap: UniqueMap = { Item: [['id']] }

function makeDelegateMock() {
  const calls: Record<string, any[]> = {}
  const handler: Record<string, (args: any) => any> = {}
  const methods = [
    'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
    'count', 'aggregate', 'groupBy',
    'create', 'createMany', 'createManyAndReturn',
    'update', 'updateMany', 'updateManyAndReturn',
    'delete', 'deleteMany',
  ]
  for (const m of methods) {
    calls[m] = []
    handler[m] = (args: any) => { calls[m].push(args); return { id: 'mock', ...args } }
  }
  return { calls, handler }
}

function makeExtension() {
  return createModelGuardExtension({
    typeMap,
    enumMap,
    zodChains,
    zodDefaults,
    uniqueMap,
    scopeMap: {},
    contextFn: () => ({}),
  })
}

describe('inline refine in data shapes', () => {
  it('create with inline refine function', () => {
    const ext = makeExtension()
    const { calls, handler } = makeDelegateMock()

    const guarded = ext.$allModels.guard.call(
      { $name: 'Item', $parent: { item: handler } } as any,
      {
        data: {
          name: (base: any) => base.min(1).max(50),
        },
      },
    )

    guarded.create({ data: { name: 'valid' } })
    expect(calls.create[0].data).toEqual({ name: 'valid' })
  })

  it('create rejects value failing inline refine', () => {
    const ext = makeExtension()
    const { handler } = makeDelegateMock()

    const guarded = ext.$allModels.guard.call(
      { $name: 'Item', $parent: { item: handler } } as any,
      {
        data: {
          name: (base: any) => base.min(5),
        },
      },
    )

    expect(() => guarded.create({ data: { name: 'ab' } })).toThrow()
  })

  it('rejects inline refine that returns non-zod value', () => {
    const ext = makeExtension()
    const { handler } = makeDelegateMock()

    const guarded = ext.$allModels.guard.call(
      { $name: 'Item', $parent: { item: handler } } as any,
      {
        data: {
          name: () => 'not a schema' as any,
        },
      },
    )

    expect(() => guarded.create({ data: { name: 'x' } })).toThrow(ShapeError)
  })

  it('rejects inline refine that throws', () => {
    const ext = makeExtension()
    const { handler } = makeDelegateMock()

    const guarded = ext.$allModels.guard.call(
      { $name: 'Item', $parent: { item: handler } } as any,
      {
        data: {
          name: () => { throw new Error('refine broke') },
        },
      },
    )

    expect(() => guarded.create({ data: { name: 'x' } })).toThrow(ShapeError)
  })

  it('update with inline refine function', () => {
    const ext = makeExtension()
    const { calls, handler } = makeDelegateMock()

    const guarded = ext.$allModels.guard.call(
      { $name: 'Item', $parent: { item: handler } } as any,
      {
        data: {
          name: (base: any) => base.min(1),
          count: (base: any) => base.min(0),
        },
        where: { id: { equals: true } },
      },
    )

    guarded.update({
      data: { name: 'updated', count: 5 },
      where: { id: { equals: 'abc' } },
    })

    expect(calls.update[0].data).toEqual({ name: 'updated', count: 5 })
  })

  it('nullable field with inline refine accepts null on create', () => {
    const ext = makeExtension()
    const { calls, handler } = makeDelegateMock()

    const guarded = ext.$allModels.guard.call(
      { $name: 'Item', $parent: { item: handler } } as any,
      {
        data: {
          name: true,
          count: (base: any) => base.min(0),
        },
      },
    )

    guarded.create({ data: { name: 'test', count: null } })
    expect(calls.create[0].data).toEqual({ name: 'test', count: null })
  })
})