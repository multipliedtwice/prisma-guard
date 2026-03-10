import { describe, it, expect } from 'vitest'
import { createSchemaBuilder } from '../../src/runtime/schema-builder.js'
import { ShapeError } from '../../src/shared/errors.js'
import type { TypeMap, EnumMap, ZodChains, FieldMeta } from '../../src/shared/types.js'
import { createScalarBase } from '../../src/shared/scalar-base.js'

const TYPE_MAP: TypeMap = {
  User: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    email: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    name: { type: 'String', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    updatedAt: { type: 'DateTime', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: true },
    companyId: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    company: { type: 'Company', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    posts: { type: 'Post', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Company: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    name: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    users: { type: 'User', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Post: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    title: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    userId: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    author: { type: 'User', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
}

const ENUM_MAP: EnumMap = {}
const scalarBase = createScalarBase(false)

function makeSb(zodChains: ZodChains = {}) {
  return createSchemaBuilder(TYPE_MAP, zodChains, ENUM_MAP, scalarBase, {})
}

describe('schema-builder coverage: buildModelSchema _count', () => {
  const sb = makeSb()

  it('_count: true includes all relation fields', () => {
    const schema = sb.buildModelSchema('User', { _count: true })
    const result = schema.parse({
      id: 'u1',
      email: 'a@b.com',
      name: null,
      updatedAt: new Date(),
      companyId: 'c1',
      _count: { company: 0, posts: 5 },
    })
    expect(result._count).toEqual({ posts: 5 })
  })

  it('_count with specific relations', () => {
    const schema = sb.buildModelSchema('User', { _count: { posts: true } })
    const result = schema.parse({
      id: 'u1',
      email: 'a@b.com',
      name: null,
      updatedAt: new Date(),
      companyId: 'c1',
      _count: { posts: 3 },
    })
    expect(result._count).toEqual({ posts: 3 })
  })

  it('throws on unknown field in _count', () => {
    expect(() => sb.buildModelSchema('User', {
      _count: { nonexistent: true },
    })).toThrow(ShapeError)
  })

  it('throws on non-relation field in _count', () => {
    expect(() => sb.buildModelSchema('User', {
      _count: { email: true },
    })).toThrow(ShapeError)
  })
})

describe('schema-builder coverage: buildInputSchema omit validation', () => {
  const sb = makeSb()

  it('throws on unknown field in omit', () => {
    expect(() => sb.buildInputSchema('User', {
      mode: 'create',
      omit: ['nonexistent'],
    })).toThrow(ShapeError)
  })

  it('omit works with valid fields', () => {
    const schema = sb.buildInputSchema('User', {
      mode: 'create',
      omit: ['companyId'],
    })
    expect(() => schema.parse({ email: 'a@b.com' })).not.toThrow()
  })
})

describe('schema-builder coverage: buildModelSchema pick/omit validation', () => {
  const sb = makeSb()

  it('throws on relation field in pick without include', () => {
    expect(() => sb.buildModelSchema('User', {
      pick: ['id', 'company'],
    })).toThrow(ShapeError)
  })

  it('throws on unknown field in pick', () => {
    expect(() => sb.buildModelSchema('User', {
      pick: ['nonexistent'],
    })).toThrow(ShapeError)
  })

  it('throws on unknown field in omit', () => {
    expect(() => sb.buildModelSchema('User', {
      omit: ['nonexistent'],
    })).toThrow(ShapeError)
  })
})

describe('schema-builder coverage: buildInputSchema relation and updatedAt guard', () => {
  const sb = makeSb()

  it('throws on relation field in pick', () => {
    expect(() => sb.buildInputSchema('User', {
      mode: 'create',
      pick: ['company'],
    })).toThrow(ShapeError)
  })

  it('throws on updatedAt field in pick', () => {
    expect(() => sb.buildInputSchema('User', {
      mode: 'create',
      pick: ['updatedAt'],
    })).toThrow(ShapeError)
  })
})

describe('schema-builder coverage: zodChains runtime error', () => {
  it('wraps chain runtime error in ShapeError', () => {
    const sb = makeSb({
      User: {
        email: () => { throw new Error('chain explosion') },
      },
    })
    expect(() => sb.buildFieldSchema('User', 'email')).toThrow(ShapeError)
    expect(() => sb.buildFieldSchema('User', 'email')).toThrow(/chain explosion/)
  })
})

describe('schema-builder coverage: unknown model/field', () => {
  const sb = makeSb()

  it('throws on unknown model in buildFieldSchema', () => {
    expect(() => sb.buildFieldSchema('Ghost', 'id')).toThrow(ShapeError)
  })

  it('throws on unknown field in buildFieldSchema', () => {
    expect(() => sb.buildFieldSchema('User', 'ghost')).toThrow(ShapeError)
  })

  it('throws on unknown model in buildInputSchema', () => {
    expect(() => sb.buildInputSchema('Ghost', { mode: 'create' })).toThrow(ShapeError)
  })

  it('throws on unknown model in buildModelSchema', () => {
    expect(() => sb.buildModelSchema('Ghost', {})).toThrow(ShapeError)
  })
})

describe('schema-builder coverage: LRU cache eviction', () => {
  it('handles more than 500 distinct field lookups without error', () => {
    const fields: Record<string, FieldMeta> = {}
    for (let i = 0; i < 510; i++) {
      fields[`f${i}`] = {
        type: 'String',
        isList: false,
        isRequired: true,
        isId: false,
        isRelation: false,
        hasDefault: false,
        isUpdatedAt: false,
      }
    }
    const largeTypeMap: TypeMap = { BigModel: fields }
    const sb = createSchemaBuilder(largeTypeMap, {}, {}, scalarBase, {})

    for (let i = 0; i < 510; i++) {
      const result = sb.buildFieldSchema('BigModel', `f${i}`)
      expect(result).toBeDefined()
    }

    const again = sb.buildFieldSchema('BigModel', 'f0')
    expect(again).toBeDefined()
  })
})

describe('schema-builder coverage: buildModelSchema depth limit', () => {
  const sb = makeSb()

  it('throws when include depth exceeds maxDepth', () => {
    expect(() => sb.buildModelSchema('User', {
      maxDepth: 1,
      include: {
        company: {
          include: {
            users: {},
          },
        },
      },
    })).toThrow(ShapeError)
    expect(() => sb.buildModelSchema('User', {
      maxDepth: 1,
      include: {
        company: {
          include: {
            users: {},
          },
        },
      },
    })).toThrow(/depth/)
  })
})

describe('schema-builder coverage: buildModelSchema related model not found', () => {
  it('throws when related model missing from type map', () => {
    const partialTypeMap: TypeMap = {
      Orphan: {
        id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
        ghost: { type: 'Ghost', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
      },
    }
    const sb = createSchemaBuilder(partialTypeMap, {}, {}, scalarBase, {})
    expect(() => sb.buildModelSchema('Orphan', {
      include: { ghost: {} },
    })).toThrow(ShapeError)
  })
})