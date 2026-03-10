import { describe, it, expect } from 'vitest'
import type { TypeMap, EnumMap, ZodChains } from '../../src/shared/types.js'
import { ShapeError } from '../../src/shared/errors.js'
import { createSchemaBuilder } from '../../src/runtime/schema-builder.js'
import { createScalarBase } from '../../src/shared/scalar-base.js'

const scalarBase = createScalarBase(false)

const typeMap: TypeMap = {
  User: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    name: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    posts: { type: 'Post', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    ghost: { type: 'Ghost', isList: false, isRequired: false, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Post: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    title: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
}

const enumMap: EnumMap = {}
const zodChains: ZodChains = {}

function sb() {
  return createSchemaBuilder(typeMap, zodChains, enumMap, scalarBase)
}

describe('schema-builder branch gaps', () => {
  describe('buildModelSchema: related model not in type map', () => {
    it('throws ShapeError when included relation points to missing model', () => {
      expect(() =>
        sb().buildModelSchema('User', {
          include: {
            ghost: {},
          },
        }),
      ).toThrow(ShapeError)
    })
  })

  describe('buildModelSchema: max depth exceeded', () => {
    const deepTypeMap: TypeMap = {
      A: {
        id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
        b: { type: 'B', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
      },
      B: {
        id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
        a: { type: 'A', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
      },
    }

    it('throws ShapeError when include depth exceeds maxDepth', () => {
      const builder = createSchemaBuilder(deepTypeMap, zodChains, enumMap, scalarBase)
      expect(() =>
        builder.buildModelSchema('A', {
          maxDepth: 2,
          include: {
            b: {
              include: {
                a: {
                  include: {
                    b: {},
                  },
                },
              },
            },
          },
        }),
      ).toThrow(ShapeError)
    })
  })

  describe('buildModelSchema: pick with relation field', () => {
    it('throws ShapeError when pick includes a relation without include', () => {
      expect(() =>
        sb().buildModelSchema('User', {
          pick: ['posts'],
        }),
      ).toThrow(ShapeError)
    })
  })

  describe('buildModelSchema: unknown field in pick', () => {
    it('throws ShapeError for unknown field in pick', () => {
      expect(() =>
        sb().buildModelSchema('User', {
          pick: ['nonexistent'],
        }),
      ).toThrow(ShapeError)
    })
  })

  describe('buildModelSchema: unknown field in omit', () => {
    it('throws ShapeError for unknown field in omit', () => {
      expect(() =>
        sb().buildModelSchema('User', {
          omit: ['nonexistent'],
        }),
      ).toThrow(ShapeError)
    })
  })

  describe('buildModelSchema: unknown field in _count', () => {
    it('throws ShapeError for unknown field in _count record', () => {
      expect(() =>
        sb().buildModelSchema('User', {
          _count: { nonexistent: true },
        }),
      ).toThrow(ShapeError)
    })

    it('throws ShapeError for non-relation field in _count record', () => {
      expect(() =>
        sb().buildModelSchema('User', {
          _count: { name: true },
        }),
      ).toThrow(ShapeError)
    })
  })

  describe('buildModelSchema: include with unknown relation', () => {
    it('throws ShapeError for unknown field in include', () => {
      expect(() =>
        sb().buildModelSchema('User', {
          include: { nonexistent: {} },
        }),
      ).toThrow(ShapeError)
    })

    it('throws ShapeError for non-relation field in include', () => {
      expect(() =>
        sb().buildModelSchema('User', {
          include: { name: {} },
        }),
      ).toThrow(ShapeError)
    })
  })
})