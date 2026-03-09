import { describe, it, expect } from 'vitest'
import { createQueryBuilder } from '../../src/runtime/query-builder.js'
import { ShapeError } from '../../src/shared/errors.js'
import type { TypeMap, EnumMap, UniqueMap } from '../../src/shared/types.js'

const typeMap: TypeMap = {
  User: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    name: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    email: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    age: { type: 'Int', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    score: { type: 'Float', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    role: { type: 'Role', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false, isEnum: true },
    active: { type: 'Boolean', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    data: { type: 'Json', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    posts: { type: 'Post', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Post: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    title: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
}

const enumMap: EnumMap = { Role: ['ADMIN', 'USER'] }
const uniqueMap: UniqueMap = { User: [['id']], Post: [['id']] }

function qb() { return createQueryBuilder(typeMap, enumMap, uniqueMap) }

describe('distinct', () => {
  it('accepts single distinct field', () => {
    const schema = qb().buildQuerySchema('User', 'findMany', { distinct: ['name'] })
    const result = schema.parse({ distinct: 'name' })
    expect(result.distinct).toBe('name')
  })

  it('accepts array distinct', () => {
    const schema = qb().buildQuerySchema('User', 'findMany', { distinct: ['name', 'email'] })
    const result = schema.parse({ distinct: ['name', 'email'] })
    expect(result.distinct).toEqual(['name', 'email'])
  })

  it('rejects unknown field in distinct', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', { distinct: ['nonexistent'] })).toThrow(ShapeError)
  })

  it('rejects relation field in distinct', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', { distinct: ['posts'] })).toThrow(ShapeError)
  })

  it('rejects empty distinct array', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', { distinct: [] })).toThrow(ShapeError)
  })
})

describe('having', () => {
  it('builds having with numeric operators', () => {
    const schema = qb().buildQuerySchema('User', 'groupBy', {
      by: ['name'],
      having: { name: true },
    })
    const result = schema.parse({
      by: ['name'],
      having: { name: { equals: 'test' } },
    })
    expect((result.having as any).name).toEqual({ equals: 'test' })
  })

  it('rejects unknown field in having', () => {
    expect(() => qb().buildQuerySchema('User', 'groupBy', {
      by: ['name'],
      having: { nonexistent: true },
    })).toThrow(ShapeError)
  })

  it('rejects relation field in having', () => {
    expect(() => qb().buildQuerySchema('User', 'groupBy', {
      by: ['name'],
      having: { posts: true },
    })).toThrow(ShapeError)
  })

  it('having field not in by is rejected', () => {
    expect(() => qb().buildQuerySchema('User', 'groupBy', {
      by: ['name'],
      having: { email: true },
    })).toThrow(ShapeError)
  })

  it('having with string mode for string fields', () => {
    const schema = qb().buildQuerySchema('User', 'groupBy', {
      by: ['name'],
      having: { name: true },
    })
    const result = schema.parse({
      by: ['name'],
      having: { name: { contains: 'test', mode: 'insensitive' } },
    })
    expect((result.having as any).name.mode).toBe('insensitive')
  })
})

describe('aggregate field schemas', () => {
  it('rejects non-numeric field in _avg', () => {
    expect(() => qb().buildQuerySchema('User', 'aggregate', {
      _avg: { name: true },
    })).toThrow(ShapeError)
  })

  it('rejects non-comparable field in _min', () => {
    expect(() => qb().buildQuerySchema('User', 'aggregate', {
      _min: { active: true },
    })).toThrow(ShapeError)
  })

  it('allows _count with _all', () => {
    const schema = qb().buildQuerySchema('User', 'aggregate', {
      _count: { _all: true, name: true },
    })
    const result = schema.parse({ _count: { _all: true } })
    expect((result._count as any)._all).toBe(true)
  })
})

describe('count select', () => {
  it('builds count with select', () => {
    const schema = qb().buildQuerySchema('User', 'count', {
      select: { name: true, email: true },
    })
    const result = schema.parse({ select: { name: true } })
    expect((result.select as any).name).toBe(true)
  })

  it('rejects relation in count select', () => {
    expect(() => qb().buildQuerySchema('User', 'count', {
      select: { posts: true },
    })).toThrow(ShapeError)
  })
})

describe('cursor unique constraint', () => {
  it('rejects cursor not covering unique constraint', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      cursor: { name: true },
    })).toThrow(ShapeError)
  })

  it('accepts cursor covering unique constraint', () => {
    const schema = qb().buildQuerySchema('User', 'findMany', {
      cursor: { id: true },
    })
    const result = schema.parse({ cursor: { id: 1 } })
    expect(result.cursor).toEqual({ id: 1 })
  })
})

describe('groupBy orderBy constraint', () => {
  it('rejects orderBy field not in by', () => {
    expect(() => qb().buildQuerySchema('User', 'groupBy', {
      by: ['name'],
      orderBy: { email: true },
    })).toThrow(ShapeError)
  })

  it('accepts orderBy field in by', () => {
    const schema = qb().buildQuerySchema('User', 'groupBy', {
      by: ['name'],
      orderBy: { name: true },
    })
    const result = schema.parse({ by: ['name'], orderBy: { name: 'asc' } })
    expect(result.orderBy).toEqual({ name: 'asc' })
  })
})

describe('list field in orderBy/cursor/by', () => {
  it('rejects list field in orderBy', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      orderBy: { posts: true },
    })).toThrow(ShapeError)
  })

  it('rejects list field in cursor', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      cursor: { posts: true },
    })).toThrow(ShapeError)
  })

  it('rejects list field in distinct', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      distinct: ['posts'],
    })).toThrow(ShapeError)
  })

  it('rejects Json field in by', () => {
    expect(() => qb().buildQuerySchema('User', 'groupBy', {
      by: ['data'],
    })).toThrow(ShapeError)
  })
})

describe('take edge cases', () => {
  it('rejects non-finite take max', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      take: { max: Infinity },
    })).toThrow(ShapeError)
  })

  it('rejects zero take max', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      take: { max: 0 },
    })).toThrow(ShapeError)
  })

  it('rejects non-integer take default', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      take: { max: 10, default: 5.5 },
    })).toThrow(ShapeError)
  })

  it('rejects zero take default', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      take: { max: 10, default: 0 },
    })).toThrow(ShapeError)
  })

  it('optional take without default', () => {
    const schema = qb().buildQuerySchema('User', 'findMany', {
      take: { max: 50 },
    })
    const result = schema.parse({})
    expect(result.take).toBeUndefined()
  })
})