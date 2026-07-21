import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  buildDataSchema,
  hasDataRefines,
  validateAllowedKeys,
  validateAndMergeData,
  validateCreateCompleteness,
} from '../../src/runtime/model-guard-data.js'
import { createSchemaBuilder } from '../../src/runtime/schema-builder.js'
import { createScalarBase } from '../../src/shared/scalar-base.js'
import { force, unsupported } from '../../src/shared/constants.js'
import { ShapeError } from '../../src/shared/errors.js'
import type {
  EnumMap,
  TypeMap,
  UniqueMap,
  ZodChains,
  ZodDefaults,
} from '../../src/shared/types.js'

const typeMap: TypeMap = {
  User: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false, isUnique: true },
    name: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    nickname: { type: 'String', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    status: { type: 'Status', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: true, isUpdatedAt: false, isEnum: true },
    companyId: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    updatedAt: { type: 'DateTime', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: true },
    legacy: { type: 'Unsupported("legacy")', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false, isUnsupported: true },
    company: { type: 'Company', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false, relationFromFields: ['companyId'] },
    posts: { type: 'Post', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    profile: { type: 'Profile', isList: false, isRequired: false, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
    broken: { type: 'MissingModel', isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Company: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false, isUnique: true },
    name: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
  Post: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false, isUnique: true },
    title: { type: 'String', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    content: { type: 'String', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    updatedAt: { type: 'DateTime', isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: true },
    legacy: { type: 'Unsupported("legacy")', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false, isUnsupported: true },
    author: { type: 'User', isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  Profile: {
    id: { type: 'String', isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false, isUnique: true },
    bio: { type: 'String', isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
  },
}

const enumMap: EnumMap = { Status: ['draft', 'active'] }
const uniqueMap: UniqueMap = {
  User: [{ selector: 'id', fields: ['id'] }],
  Company: [{ selector: 'id', fields: ['id'] }],
  Post: [{ selector: 'id', fields: ['id'] }],
  Profile: [{ selector: 'id', fields: ['id'] }],
}
const scalarBase = createScalarBase(false)

function makeBuilder(
  zodChains: ZodChains = {},
  zodDefaults: ZodDefaults = {},
) {
  return createSchemaBuilder(
    typeMap,
    zodChains,
    enumMap,
    scalarBase,
    zodDefaults,
  )
}

function build(
  dataConfig: Record<string, true | unknown>,
  mode: 'create' | 'update' = 'update',
  allowRelationWrites = true,
  zodChains: ZodChains = {},
  zodDefaults: ZodDefaults = {},
) {
  return buildDataSchema(
    'User',
    dataConfig,
    mode,
    typeMap,
    uniqueMap,
    enumMap,
    scalarBase,
    makeBuilder(zodChains, zodDefaults),
    zodDefaults,
    allowRelationWrites,
  )
}

describe('model-guard-data exported helpers', () => {
  it('validates body and shape keys with distinct messages', () => {
    expect(() =>
      validateAllowedKeys({ extra: true }, new Set(['data']), 'create', 'body'),
    ).toThrow('Unexpected key "extra" in create body')

    expect(() =>
      validateAllowedKeys({ extra: true }, new Set(['data']), 'create', 'shape'),
    ).toThrow('Shape key "extra" not valid for create')

    expect(() =>
      validateAllowedKeys({ data: true }, new Set(['data']), 'create', 'body'),
    ).not.toThrow()
  })

  it('checks create completeness and relation-covered foreign keys', () => {
    expect(() =>
      validateCreateCompleteness(
        'User',
        { name: true },
        typeMap,
        new Set(),
        {},
      ),
    ).toThrow('companyId')

    expect(() =>
      validateCreateCompleteness(
        'User',
        { name: true, company: { connect: { id: true } } },
        typeMap,
        new Set(),
        {},
      ),
    ).not.toThrow()

    expect(() =>
      validateCreateCompleteness(
        'User',
        { company: true },
        typeMap,
        new Set(['companyId']),
        { User: ['name'] },
      ),
    ).not.toThrow()

    expect(() =>
      validateCreateCompleteness('Missing', {}, typeMap, new Set(), {}),
    ).not.toThrow()
  })

  it('merges forced values with deep cloning and wraps parse failures', () => {
    const cached = {
      schema: z.object({ name: z.string() }).strict(),
      forced: { nested: { value: 1 } },
    }

    const first = validateAndMergeData({ name: 'A' }, cached, 'create', 'User')
    expect(first).toEqual({ name: 'A', nested: { value: 1 } })
    ;(first.nested as { value: number }).value = 2

    const second = validateAndMergeData({ name: 'B' }, cached, 'create')
    expect(second).toEqual({ name: 'B', nested: { value: 1 } })

    expect(() => validateAndMergeData(undefined, cached, 'create')).toThrow(
      'create requires "data"',
    )
    expect(() =>
      validateAndMergeData({ name: 1 }, cached, 'create', 'User'),
    ).toThrow('Invalid data for create on model "User"')
    expect(() => validateAndMergeData({ name: 1 }, cached, 'create')).toThrow(
      'Invalid data for create',
    )
  })

  it('detects inline data refines', () => {
    expect(hasDataRefines({ name: true })).toBe(false)
    expect(hasDataRefines({ name: (base: unknown) => base })).toBe(true)
  })
})

describe('model-guard-data scalar and metadata branches', () => {
  it('handles unsupported markers and forced unsupported values', () => {
    const forcedValue = { nested: { value: 1 } }
    const built = build(
      {
        name: true,
        unknownAcknowledged: unsupported(),
        legacyAcknowledged: unsupported(),
        legacy: force(forcedValue),
      },
      'create',
    )

    forcedValue.nested.value = 2
    expect(built.forced).toEqual({ legacy: { nested: { value: 1 } } })
    expect(built.schema.parse({ name: 'A' })).toEqual({ name: 'A' })
  })

  it('rejects invalid unknown, unsupported, updatedAt, and relation fields', () => {
    expect(() => build({ missing: true })).toThrow('Unknown field "missing"')
    expect(() => build({ legacy: true })).toThrow('Unsupported type')
    expect(() => build({ legacy: () => z.string() })).toThrow('Unsupported type')
    expect(() => build({ updatedAt: true })).toThrow('updatedAt field')
    expect(() => build({ posts: { create: { title: true } } }, 'update', false)).toThrow(
      'Relation writes are not supported',
    )
    expect(() => build({ posts: true })).toThrow('requires a relation write config object')
  })

  it('parses forced values and nullable forced values', () => {
    const built = build({ name: force('server'), nickname: force(null) })
    expect(built.forced).toEqual({ name: 'server', nickname: null })
    expect(() => build({ name: force(true) })).toThrow('Invalid forced data value')
  })

  it('applies omitted zod defaults and skips invalid default metadata entries', () => {
    const zodChains: ZodChains = {
      User: {
        status: (base) => base.default('draft'),
      },
    }
    const zodDefaults: ZodDefaults = {
      User: ['missing', 'posts', 'updatedAt', 'status'],
    }

    const built = build({ name: true }, 'create', true, zodChains, zodDefaults)
    expect(built.forced).toEqual({ status: 'draft' })

    expect(() =>
      build(
        { nickname: true },
        'create',
        true,
        {},
        { User: ['name'] },
      ),
    ).toThrow('does not produce a value for undefined input')
  })

  it('rejects unknown models and unknown related models', () => {
    expect(() =>
      buildDataSchema(
        'Missing',
        {},
        'create',
        typeMap,
        uniqueMap,
        enumMap,
        scalarBase,
        makeBuilder(),
        {},
        true,
      ),
    ).toThrow('Unknown model: Missing')

    expect(() => build({ broken: { connect: { id: true } } })).toThrow(
      'Unknown related model "MissingModel"',
    )
  })
})

describe('model-guard-data relation write success paths', () => {
  it('parses connect, create, connectOrCreate, createMany, and set on to-many relations', () => {
    const built = build({
      posts: {
        connect: { id: true },
        create: { title: true, content: true },
        connectOrCreate: {
          where: { id: true },
          create: { title: true },
        },
        createMany: {
          data: { title: true, content: true },
          skipDuplicates: true,
        },
        set: { id: true },
      },
    })

    const parsed = built.schema.parse({
      posts: {
        connect: [{ id: 'p1' }, { id: 'p2' }],
        create: [{ title: 'A' }, { title: 'B', content: null }],
        connectOrCreate: {
          where: { id: 'p3' },
          create: { title: 'C' },
        },
        createMany: {
          data: [{ title: 'D' }],
          skipDuplicates: true,
        },
        set: [],
      },
    })

    expect(parsed.posts).toEqual({
      connect: [{ id: 'p1' }, { id: 'p2' }],
      create: [{ title: 'A' }, { title: 'B', content: null }],
      connectOrCreate: {
        where: { id: 'p3' },
        create: { title: 'C' },
      },
      createMany: {
        data: [{ title: 'D' }],
        skipDuplicates: true,
      },
      set: [],
    })
  })

  it('parses disconnect, delete, update, upsert, updateMany, and deleteMany on to-many relations', () => {
    const built = build({
      posts: {
        disconnect: { id: true },
        delete: { id: true },
        update: { where: { id: true }, data: { title: true, content: true } },
        upsert: {
          where: { id: true },
          create: { title: true },
          update: { title: true, content: true },
        },
        updateMany: {
          where: { title: true },
          data: { title: true, content: true },
        },
        deleteMany: { title: true },
      },
    })

    const parsed = built.schema.parse({
      posts: {
        disconnect: { id: 'p1' },
        delete: [{ id: 'p2' }],
        update: {
          where: { id: 'p3' },
          data: { content: null },
        },
        upsert: {
          where: { id: 'p4' },
          create: { title: 'Created' },
          update: {},
        },
        updateMany: {
          where: { title: 'old' },
          data: { title: 'new' },
        },
        deleteMany: [{ title: 'obsolete' }],
      },
    })

    expect(parsed.posts).toEqual({
      disconnect: { id: 'p1' },
      delete: [{ id: 'p2' }],
      update: {
        where: { id: 'p3' },
        data: { content: null },
      },
      upsert: {
        where: { id: 'p4' },
        create: { title: 'Created' },
        update: {},
      },
      updateMany: {
        where: { title: 'old' },
        data: { title: 'new' },
      },
      deleteMany: [{ title: 'obsolete' }],
    })
  })

  it('parses to-one connect, disconnect, delete, update, and both upsert variants', () => {
    const withoutWhere = build({
      profile: {
        connect: { id: true },
        disconnect: true,
        delete: true,
        update: { bio: true },
        upsert: {
          create: { bio: true },
          update: { bio: true },
        },
      },
    })

    expect(
      withoutWhere.schema.parse({
        profile: {
          connect: { id: 'pr1' },
          disconnect: true,
          delete: true,
          update: { bio: null },
          upsert: {
            create: { bio: 'created' },
            update: {},
          },
        },
      }),
    ).toEqual({
      profile: {
        connect: { id: 'pr1' },
        disconnect: true,
        delete: true,
        update: { bio: null },
        upsert: {
          create: { bio: 'created' },
          update: {},
        },
      },
    })

    const withWhere = build({
      profile: {
        upsert: {
          where: { id: true },
          create: { bio: true },
          update: { bio: true },
        },
      },
    })

    expect(
      withWhere.schema.parse({
        profile: {
          upsert: {
            where: { id: 'pr1' },
            create: {},
            update: { bio: 'updated' },
          },
        },
      }),
    ).toEqual({
      profile: {
        upsert: {
          where: { id: 'pr1' },
          create: {},
          update: { bio: 'updated' },
        },
      },
    })
  })
})

describe('model-guard-data relation write failures', () => {
  it('rejects unknown and empty relation operation configs', () => {
    expect(() => build({ posts: { unknown: {} } })).toThrow(
      'Unknown relation write operation "unknown"',
    )
    expect(() => build({ posts: {} })).toThrow('Empty relation write config')
    expect(() => build({ posts: { connect: undefined } })).toThrow(
      'Empty relation write config',
    )
  })

  it('rejects invalid operation cardinalities', () => {
    expect(() => build({ profile: { createMany: { data: { bio: true } } } })).toThrow(
      'createMany is only valid on to-many',
    )
    expect(() => build({ profile: { set: { id: true } } })).toThrow(
      'set is only valid on to-many',
    )
    expect(() => build({ profile: { updateMany: { where: { bio: true }, data: { bio: true } } } })).toThrow(
      'updateMany is only valid on to-many',
    )
    expect(() => build({ profile: { deleteMany: { bio: true } } })).toThrow(
      'deleteMany is only valid on to-many',
    )
    expect(() => build({ posts: { disconnect: true } })).toThrow(
      'requires unique selector config, not true',
    )
    expect(() => build({ posts: { delete: true } })).toThrow(
      'requires unique selector config, not true',
    )
  })

  it('rejects malformed relation operation configs and extra keys', () => {
    expect(() => build({ posts: { connect: true } })).toThrow('connect config')
    expect(() => build({ posts: { disconnect: 'x' } })).toThrow('disconnect config')
    expect(() => build({ posts: { delete: 'x' } })).toThrow('delete config')
    expect(() => build({ posts: { connectOrCreate: { where: { id: true }, create: { title: true }, extra: true } } })).toThrow(
      'Unknown key "extra"',
    )
    expect(() => build({ posts: { createMany: { data: { title: true }, extra: true } } })).toThrow(
      'Unknown key "extra"',
    )
    expect(() => build({ posts: { update: { where: { id: true }, data: { title: true }, extra: true } } })).toThrow(
      'Unknown key "extra"',
    )
    expect(() => build({ posts: { upsert: { where: { id: true }, create: { title: true }, update: { title: true }, extra: true } } })).toThrow(
      'Unknown key "extra"',
    )
    expect(() => build({ posts: { updateMany: { where: { title: true }, data: { title: true }, extra: true } } })).toThrow(
      'Unknown key "extra"',
    )
  })

  it('requires nested objects and constrained bulk operations', () => {
    expect(() => build({ posts: { connectOrCreate: { create: { title: true } } } })).toThrow(
      'requires "where" object',
    )
    expect(() => build({ posts: { connectOrCreate: { where: { id: true } } } })).toThrow(
      'requires "create" object',
    )
    expect(() => build({ posts: { createMany: {} } })).toThrow(
      'requires "data" object',
    )
    expect(() => build({ posts: { update: { data: { title: true } } } })).toThrow(
      'requires "where" object',
    )
    expect(() => build({ posts: { update: { where: { id: true } } } })).toThrow(
      'requires "data" object',
    )
    expect(() => build({ posts: { upsert: { create: { title: true }, update: { title: true } } } })).toThrow(
      'requires "where" object',
    )
    expect(() => build({ profile: { upsert: { where: true, create: { bio: true }, update: { bio: true } } } })).toThrow(
      'invalid "where"',
    )
    expect(() => build({ posts: { updateMany: { where: {}, data: { title: true } } } })).toThrow(
      'must define at least one filter field',
    )
    expect(() => build({ posts: { updateMany: { where: { title: true }, data: {} } } })).toThrow(
      'must define at least one field',
    )
    expect(() => build({ posts: { deleteMany: {} } })).toThrow(
      'Unconstrained nested deletes are not allowed',
    )
  })

  it('rejects invalid nested data and filter configurations', () => {
    expect(() => build({ posts: { create: { title: false } } })).toThrow(
      'must be true',
    )
    expect(() => build({ posts: { create: { missing: true } } })).toThrow(
      'Unknown field "missing"',
    )
    expect(() => build({ posts: { create: { author: true } } })).toThrow(
      'Nested relation writes inside nested data are not supported',
    )
    expect(() => build({ posts: { create: { updatedAt: true } } })).toThrow(
      'updatedAt field',
    )
    expect(() => build({ posts: { create: { legacy: true } } })).toThrow(
      'Unsupported type',
    )
    expect(() => build({ posts: { updateMany: { where: { title: false }, data: { title: true } } } })).toThrow(
      'filter config must be true',
    )
    expect(() => build({ posts: { updateMany: { where: { missing: true }, data: { title: true } } } })).toThrow(
      'Unknown field "missing"',
    )
    expect(() => build({ posts: { updateMany: { where: { author: true }, data: { title: true } } } })).toThrow(
      'cannot be used in filter',
    )
  })

  it('rejects invalid nested write bodies after schema construction', () => {
    const create = build({ posts: { create: { title: true } } })
    expect(() => create.schema.parse({ posts: { create: {} } })).toThrow()

    const updateMany = build({
      posts: {
        updateMany: {
          where: { title: true },
          data: { title: true },
        },
      },
    })
    expect(() =>
      updateMany.schema.parse({
        posts: { updateMany: { where: {}, data: { title: 'x' } } },
      }),
    ).toThrow('At least one field required in filter')

    const createMany = build({
      posts: {
        createMany: {
          data: { title: true },
          skipDuplicates: true,
        },
      },
    })
    expect(() =>
      createMany.schema.parse({
        posts: { createMany: { data: { title: 'x' }, skipDuplicates: 'yes' } },
      }),
    ).toThrow()
  })
})
