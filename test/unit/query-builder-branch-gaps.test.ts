import { describe, it, expect } from 'vitest'
import type { TypeMap, EnumMap } from '../../src/shared/types.js'
import { ShapeError, CallerError } from '../../src/shared/errors.js'
import { createQueryBuilder } from '../../src/runtime/query-builder.js'

const typeMap: TypeMap = {
  User: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    name: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    email: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    role: { type: 'Role', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false, isEnum: true },
    age: { type: 'Int', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    data: { type: 'Json', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    posts: { type: 'Post', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    profile: { type: 'Profile', isList: false, isRequired: false, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Post: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    title: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    published: { type: 'Boolean', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    userId: { type: 'Int', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    author: { type: 'User', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    comments: { type: 'Comment', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Comment: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    text: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    postId: { type: 'Int', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    post: { type: 'Post', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Profile: {
    id: { type: 'Int', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    bio: { type: 'String', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    userId: { type: 'Int', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    user: { type: 'User', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
}

const enumMap: EnumMap = { Role: ['ADMIN', 'USER'] }

function qb() { return createQueryBuilder(typeMap, enumMap) }

describe('query-builder branch gaps', () => {
  describe('buildSelectSchema: nested args on non-relation scalar', () => {
    it('throws ShapeError for nested select args on scalar field', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', {
        select: { name: { select: { something: true } } as any },
      })).toThrow(ShapeError)
    })
  })

  describe('buildIncludeSchema: both select and include in nested config', () => {
    it('throws ShapeError when nested include defines both select and include', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', {
        include: { posts: { select: { title: true }, include: { comments: true } } as any },
      })).toThrow(ShapeError)
    })
  })

  describe('buildTakeSchema: default > max', () => {
    it('throws ShapeError when take default exceeds max', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', {
        where: { name: { equals: true } }, take: { max: 10, default: 20 },
      })).toThrow(ShapeError)
    })
  })

  describe('validateShapeArgs', () => {
    it('throws ShapeError for groupBy without by', () => {
      expect(() => qb().buildQuerySchema('User', 'groupBy', {
        where: { name: { equals: true } },
      })).toThrow(ShapeError)
    })

    it('throws ShapeError for groupBy with include', () => {
      expect(() => qb().buildQuerySchema('User', 'groupBy', {
        by: ['name'], include: { posts: true },
      })).toThrow(ShapeError)
    })

    it('throws ShapeError for groupBy with select', () => {
      expect(() => qb().buildQuerySchema('User', 'groupBy', {
        by: ['name'], select: { name: true },
      })).toThrow(ShapeError)
    })

    it('throws ShapeError for aggregate with include', () => {
      expect(() => qb().buildQuerySchema('User', 'aggregate', {
        include: { posts: true },
      } as any)).toThrow(ShapeError)
    })

    it('throws ShapeError for aggregate with select', () => {
      expect(() => qb().buildQuerySchema('User', 'aggregate', {
        select: { name: true },
      } as any)).toThrow(ShapeError)
    })

    it('throws ShapeError for disallowed arg on method', () => {
      expect(() => qb().buildQuerySchema('User', 'count', {
        include: { posts: true },
      } as any)).toThrow(ShapeError)
    })
  })

  describe('buildIncludeCountSchema', () => {
    it('throws ShapeError for _count config object without select key', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', {
        include: { _count: { where: {} } as any },
      })).toThrow(ShapeError)
    })

    it('throws ShapeError for non-relation field in _count.select', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', {
        include: { _count: { select: { name: true } } as any },
      })).toThrow(ShapeError)
    })

    it('throws ShapeError for empty _count.select', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', {
        include: { _count: { select: {} } },
      })).toThrow(ShapeError)
    })
  })

  describe('buildAggregateFieldSchema', () => {
    it('throws ShapeError for unknown field in _avg', () => {
      expect(() => qb().buildQuerySchema('User', 'aggregate', { _avg: { nonexistent: true } })).toThrow(ShapeError)
    })

    it('throws ShapeError for relation field in _sum', () => {
      expect(() => qb().buildQuerySchema('User', 'aggregate', { _sum: { posts: true } })).toThrow(ShapeError)
    })
  })

  describe('buildBySchema', () => {
    it('throws ShapeError for unknown field in by', () => {
      expect(() => qb().buildQuerySchema('User', 'groupBy', { by: ['nonexistent'] })).toThrow(ShapeError)
    })

    it('throws ShapeError for relation field in by', () => {
      expect(() => qb().buildQuerySchema('User', 'groupBy', { by: ['posts'] })).toThrow(ShapeError)
    })
  })

  describe('buildCursorSchema: relation field', () => {
    it('throws ShapeError for relation field in cursor', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', { cursor: { posts: true } })).toThrow(ShapeError)
    })
  })

  describe('buildOrderBySchema: Json field', () => {
    it('throws ShapeError for Json field in orderBy', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', { orderBy: { data: true } })).toThrow(ShapeError)
    })
  })

  describe('buildCountFieldSchema', () => {
    it('throws ShapeError for unknown field in _count record config', () => {
      expect(() => qb().buildQuerySchema('User', 'aggregate', { _count: { nonexistent: true } })).toThrow(ShapeError)
    })
  })

  describe('multi-caller parse: body validation', () => {
    it('throws ShapeError when body is not an object', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        'route/a': { where: { name: { equals: true } } },
      })
      expect(() => schema.parse('not-an-object')).toThrow(ShapeError)
    })

    it('throws ShapeError when body is an array', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        'route/a': { where: { name: { equals: true } } },
      })
      expect(() => schema.parse([1, 2])).toThrow(ShapeError)
    })

    it('throws CallerError when caller is not a string', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        'route/a': { where: { name: { equals: true } } },
      })
      expect(() => schema.parse({}, { caller: 123 as any })).toThrow(CallerError)
    })

    it('throws CallerError for unknown caller', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        'route/a': { where: { name: { equals: true } } },
      })
      expect(() => schema.parse({}, { caller: 'unknown/path' })).toThrow(CallerError)
    })
  })

  describe('multi-caller parse: parameterized patterns', () => {
    it('matches parameterized caller pattern', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        'users/:id/posts': { where: { name: { equals: true } } },
      })
      const result = schema.parse(
        { where: { name: { equals: 'test' } } },
        { caller: 'users/42/posts' },
      )
      expect(result).toHaveProperty('where')
    })

    it('throws CallerError for ambiguous parameterized patterns', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        'users/:id/posts': { where: { name: { equals: true } } },
        'users/:userId/posts': { where: { name: { equals: true } } },
      })
      expect(() => schema.parse({}, { caller: 'users/42/posts' })).toThrow(CallerError)
    })

    it('does not match pattern with different segment count', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        'users/:id': { where: { name: { equals: true } } },
      })
      expect(() => schema.parse({}, { caller: 'users/42/posts' })).toThrow(CallerError)
    })
  })

  describe('multi-caller parse: function shape resolution', () => {
    it('resolves function shape with context', () => {
      const schema = qb().buildQuerySchema<{ tenantId: number }>('User', 'findMany', {
        'admin/users': (ctx) => ({ where: { id: { equals: true } } }),
      })
      const result = schema.parse(
        { where: { id: { equals: 5 } } },
        { ctx: { tenantId: 1 }, caller: 'admin/users' },
      )
      expect(result.where).toEqual({ id: { equals: 5 } })
    })

    it('throws when function shape caller has no context', () => {
      const schema = qb().buildQuerySchema<{ tenantId: number }>('User', 'findMany', {
        'admin/users': (_ctx) => ({ where: { name: { equals: true } } }),
      })
      expect(() => schema.parse({}, { caller: 'admin/users' })).toThrow()
    })
  })

  describe('single shape: function shape resolution', () => {
    it('resolves single function shape with context', () => {
      const schema = qb().buildQuerySchema<{ role: string }>('User', 'findMany',
        (ctx) => ({ where: { name: { equals: true } } }),
      )
      const result = schema.parse(
        { where: { name: { equals: 'test' } } },
        { ctx: { role: 'admin' } },
      )
      expect(result.where).toEqual({ name: { equals: 'test' } })
    })

    it('throws when single function shape has no context', () => {
      const schema = qb().buildQuerySchema<{ role: string }>('User', 'findMany',
        (_ctx) => ({ where: { name: { equals: true } } }),
      )
      expect(() => schema.parse({ where: {} })).toThrow()
    })
  })

  describe('forced where merge', () => {
    it('injects forced where when no client where provided', () => {
      const schema = qb().buildQuerySchema('Post', 'findMany', {
        where: { published: { equals: true, not: true }, userId: { equals: 42 } },
      })
      const result = schema.parse({ where: { published: { equals: true } } })
      expect(result.where).toEqual({
        AND: [{ published: { equals: true } }, { userId: { equals: 42 } }],
      })
    })

    it('injects forced where when client sends empty body', () => {
      const schema = qb().buildQuerySchema('Post', 'findMany', {
        where: { userId: { equals: 42 } },
      })
      const result = schema.parse({})
      expect(result.where).toEqual({ userId: { equals: 42 } })
    })
  })

  describe('forced include tree', () => {
    it('expands include true with forced nested where', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        include: { posts: { where: { published: { equals: true, not: false } } } },
      })
      const result = schema.parse({ include: { posts: true } })
      expect(result.include).toEqual({ posts: { where: { published: { not: false } } } })
    })

    it('merges forced where into existing nested include args', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        include: { posts: { where: { title: { contains: true }, userId: { equals: 99 } } } },
      })
      const result = schema.parse({ include: { posts: { where: { title: { contains: 'hello' } } } } })
      const postsWhere = (result.include as any).posts.where
      expect(postsWhere).toEqual({
        AND: [{ title: { contains: 'hello' } }, { userId: { equals: 99 } }],
      })
    })
  })

  describe('forced select tree', () => {
    it('expands select true with forced nested where', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        select: { name: true, posts: { where: { published: { not: false } } } },
      })
      const result = schema.parse({ select: { name: true, posts: true } })
      expect((result.select as any).posts).toEqual({ where: { published: { not: false } } })
    })

    it('merges forced where into existing nested select args', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        select: { posts: { select: { title: true }, where: { userId: { equals: 99 } } } },
      })
      const result = schema.parse({ select: { posts: { select: { title: true } } } })
      const posts = (result.select as any).posts
      expect(posts.where).toEqual({ userId: { equals: 99 } })
    })
  })

  describe('reserved caller key collision', () => {
    it('throws ShapeError when caller key collides with shape config key', () => {
      expect(() => qb().buildQuerySchema('User', 'findMany', {
        where: { name: { equals: true } },
      } as any)).not.toThrow()

      expect(() => qb().buildQuerySchema('User', 'findMany', {
        'valid/caller': { where: { name: { equals: true } } },
        where: { name: { equals: true } } as any,
      } as any)).toThrow(ShapeError)
    })
  })

  describe('include with nested orderBy, cursor, take, skip', () => {
    it('parses nested include with orderBy and take', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        include: { posts: { orderBy: { title: true }, take: { max: 50, default: 10 }, skip: true, cursor: { id: true } } },
      })
      const result = schema.parse({
        include: { posts: { orderBy: { title: 'asc' }, take: 5, skip: 0, cursor: { id: 1 } } },
      })
      expect((result.include as any).posts.orderBy).toEqual({ title: 'asc' })
    })
  })

  describe('select with nested orderBy, cursor, take, skip', () => {
    it('parses nested select with orderBy and take', () => {
      const schema = qb().buildQuerySchema('User', 'findMany', {
        select: { posts: { select: { title: true }, orderBy: { title: true }, take: { max: 50, default: 10 }, skip: true, cursor: { id: true } } },
      })
      const result = schema.parse({
        select: { posts: { select: { title: true }, orderBy: { title: 'desc' }, take: 20, skip: 5, cursor: { id: 10 } } },
      })
      expect((result.select as any).posts.orderBy).toEqual({ title: 'desc' })
    })
  })

  describe('forced where conflict detection', () => {
    it('throws ShapeError on conflicting forced scalar values', () => {
      expect(() => qb().buildQuerySchema('Post', 'findMany', {
        where: {
          userId: { equals: 42 },
          AND: { userId: { equals: 99 } },
        },
      })).toThrow(ShapeError)
    })

    it('allows identical forced scalar values', () => {
      expect(() => qb().buildQuerySchema('Post', 'findMany', {
        where: {
          userId: { equals: 42 },
          AND: { userId: { equals: 42 } },
        },
      })).not.toThrow()
    })
  })
})