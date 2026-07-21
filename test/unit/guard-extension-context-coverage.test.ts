import { describe, it, expect } from 'vitest'
import { createGuard } from '../../src/runtime/guard.js'
import { PolicyError } from '../../src/shared/errors.js'
import type {
  EnumMap,
  GuardGeneratedConfig,
  ScopeMap,
  TypeMap,
  ZodChains,
} from '../../src/shared/types.js'

const typeMap: TypeMap = {
  Post: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false, isUnique: true },
    userId: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
}
const enumMap: EnumMap = {}
const zodChains: ZodChains = {}
const scopeMap: ScopeMap = {
  Post: [{ fk: 'userId', root: 'User', relationName: 'author' }],
}
const guardConfig: GuardGeneratedConfig = {
  onMissingScopeContext: 'error',
  findUniqueMode: 'verify',
}

function makeGuard() {
  return createGuard({
    typeMap,
    enumMap,
    zodChains,
    scopeMap,
    guardConfig,
    uniqueMap: { Post: [{ selector: 'id', fields: ['id'] }] },
  })
}

describe('guard extension scope context filtering', () => {
  it('rejects non-primitive values for configured scope roots', () => {
    const extension = makeGuard().extension(() => ({ User: { id: 'u1' } }))
    const handler = extension.query.$allOperations as any

    expect(() =>
      handler({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: (args: unknown) => args,
      }),
    ).toThrow(PolicyError)
  })

  it('ignores non-primitive values for keys that are not scope roots', async () => {
    const extension = makeGuard().extension(() => ({
      User: 'u1',
      unrelated: { value: true },
    }))
    const handler = extension.query.$allOperations as any

    const result = await handler({
      model: 'Post',
      operation: 'findMany',
      args: {},
      query: async (args: unknown) => args,
    })

    expect(result).toEqual({ where: { userId: 'u1' } })
  })

  it('ignores null and undefined scope root values for missing-scope handling', () => {
    const nullExtension = makeGuard().extension(() => ({ User: null }))
    const undefinedExtension = makeGuard().extension(() => ({ User: undefined }))

    expect(() =>
      (nullExtension.query.$allOperations as any)({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: (args: unknown) => args,
      }),
    ).toThrow(PolicyError)

    expect(() =>
      (undefinedExtension.query.$allOperations as any)({
        model: 'Post',
        operation: 'findMany',
        args: {},
        query: (args: unknown) => args,
      }),
    ).toThrow(PolicyError)
  })
})
