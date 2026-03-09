import { describe, it, expect } from 'vitest'
import { createQueryBuilder } from '../../src/runtime/query-builder.js'
import { ShapeError } from '../../src/shared/errors.js'
import type { TypeMap, EnumMap, UniqueMap } from '../../src/shared/types.js'

const typeMap: TypeMap = {
  User: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    name: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    companyId: { type: 'Int', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    posts: { type: 'Post', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Post: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    title: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    published: { type: 'Boolean', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    userId: { type: 'Int', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    author: { type: 'User', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
}

const enumMap: EnumMap = {}
const uniqueMap: UniqueMap = { User: [['id']], Post: [['id']] }

function qb() { return createQueryBuilder(typeMap, enumMap, uniqueMap) }

describe('forced where on findUnique', () => {
  it('merges forced where into unique where preserving top-level keys', () => {
    const schema = qb().buildQuerySchema('User', 'findUnique', {
      where: { id: { equals: true }, companyId: { equals: 99 } },
    })
    const result = schema.parse({ where: { id: { equals: 5 } } })
    expect(result.where).toEqual({
      id: { equals: 5 },
      AND: [{ companyId: { equals: 99 } }],
    })
  })
})

describe('_count with forced where in include', () => {
 it('builds _count.select with forced where on relation', () => {
    const schema = qb().buildQuerySchema('User', 'findMany', {
      include: {
        _count: {
          select: {
            posts: {
              where: { userId: { equals: 42 } },
            },
          },
        },
      },
    })
    const result = schema.parse({
      include: { _count: { select: { posts: true } } },
    })
    const countPosts = (result.include as any)._count.select.posts
    expect(countPosts).toEqual({ where: { userId: { equals: 42 } } })
  })

 it('preserves _count.select with forced where when client sends object', () => {
    const schema = qb().buildQuerySchema('User', 'findMany', {
      include: {
        _count: {
          select: {
            posts: {
              where: { title: { contains: true }, userId: { equals: 42 } },
            },
          },
        },
      },
    })
    const result = schema.parse({
      include: { _count: { select: { posts: { where: { title: { contains: 'hello' } } } } } },
    })
    const countPosts = (result.include as any)._count.select.posts
    expect(countPosts.where).toEqual({
      AND: [{ title: { contains: 'hello' } }, { userId: { equals: 42 } }],
    })
  })
})

describe('nested forced tree with include inside include', () => {
  it('forces nested include tree', () => {
    const schema = qb().buildQuerySchema('User', 'findMany', {
      include: {
        posts: {
          include: {
            author: true,
          },
        },
      },
    })
    const result = schema.parse({
      include: { posts: { include: { author: true } } },
    })
    expect((result.include as any).posts.include.author).toBe(true)
  })
})

describe('forced where conflict in relation filters', () => {
  it('throws on conflicting forced values in nested relation filter', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      where: {
        posts: {
          some: {
            userId: { equals: 1 },
          },
        },
        AND: {
          posts: {
            some: {
              userId: { equals: 2 },
            },
          },
        },
      },
    })).toThrow(ShapeError)
  })

  it('allows identical forced values in nested relation filter', () => {
    expect(() => qb().buildQuerySchema('User', 'findMany', {
      where: {
        posts: {
          some: {
            userId: { equals: 1 },
          },
        },
        AND: {
          posts: {
            some: {
              userId: { equals: 1 },
            },
          },
        },
      },
    })).not.toThrow()
  })
})

describe('unique where validation', () => {
  it('validates resolved unique where covers constraint', () => {
    const schema = qb().buildQuerySchema('User', 'findUnique', {
      where: { id: { equals: true } },
    })
    const result = schema.parse({ where: { id: { equals: 5 } } })
    expect(result.where).toEqual({ id: { equals: 5 } })
  })

  it('validates findUniqueOrThrow requires where in shape', () => {
    expect(() => qb().buildQuerySchema('User', 'findUniqueOrThrow', {})).toThrow(ShapeError)
  })
})