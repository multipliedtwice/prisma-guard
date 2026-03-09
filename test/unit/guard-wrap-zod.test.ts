import { describe, it, expect } from 'vitest'
import { createGuard } from '../../src/runtime/guard.js'
import { ShapeError } from '../../src/shared/errors.js'
import type { TypeMap, EnumMap, ZodChains, ScopeMap, GuardGeneratedConfig } from '../../src/shared/types.js'

const TYPE_MAP: TypeMap = {
  User: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    email: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    name: { type: 'String', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
}

const ENUM_MAP: EnumMap = {}
const ZOD_CHAINS: ZodChains = {}
const SCOPE_MAP: ScopeMap = {}
const GUARD_CONFIG: GuardGeneratedConfig = { onMissingScopeContext: 'error' }

function makeGuard(wrapZodErrors: boolean) {
  return createGuard({
    typeMap: TYPE_MAP,
    enumMap: ENUM_MAP,
    zodChains: ZOD_CHAINS,
    scopeMap: SCOPE_MAP,
    guardConfig: GUARD_CONFIG,
    wrapZodErrors,
  })
}

describe('guard wrapZodErrors', () => {
  describe('input()', () => {
    it('wraps ZodError as ShapeError when wrapZodErrors is true', () => {
      const guard = makeGuard(true)
      const schema = guard.input('User', { mode: 'create', pick: ['email'] })
      expect(() => schema.parse({ email: 123 })).toThrow(ShapeError)
    })

    it('throws raw ZodError when wrapZodErrors is false', () => {
      const guard = makeGuard(false)
      const schema = guard.input('User', { mode: 'create', pick: ['email'] })
      expect(() => schema.parse({ email: 123 })).toThrow()
      try {
        schema.parse({ email: 123 })
      } catch (err: any) {
        expect(err.name).not.toBe('ShapeError')
      }
    })

    it('wrapped input parse still returns valid data', () => {
      const guard = makeGuard(true)
      const schema = guard.input('User', { mode: 'create', pick: ['email'] })
      const result = schema.parse({ email: 'test@test.com' })
      expect(result).toEqual({ email: 'test@test.com' })
    })
  })

  describe('query()', () => {
    it('wraps ZodError as ShapeError when wrapZodErrors is true', () => {
      const guard = makeGuard(true)
      const schema = guard.query('User', 'findMany', {
        where: { email: { contains: true } },
      })
      expect(() => schema.parse({ where: { email: { contains: 123 } } })).toThrow(ShapeError)
    })

    it('wrapped query parse still returns valid data', () => {
      const guard = makeGuard(true)
      const schema = guard.query('User', 'findMany', {
        where: { email: { contains: true } },
      })
      const result = schema.parse({ where: { email: { contains: 'test' } } })
      expect(result.where).toEqual({ email: { contains: 'test' } })
    })
  })
})