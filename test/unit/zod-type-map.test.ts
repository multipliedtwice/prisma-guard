import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createBaseType, createOperatorSchema } from '../../src/runtime/zod-type-map.js'
import type { FieldMeta, EnumMap } from '../../src/shared/types.js'

function field(overrides: Partial<FieldMeta> = {}): FieldMeta {
  return {
    type: 'String',
    isList: false,
    isRequired: true,
    isId: false,
    isRelation: false,
    hasDefault: false,
    isUpdatedAt: false,
    ...overrides,
  }
}

const ENUM_MAP: EnumMap = {
  Role: ['USER', 'ADMIN'],
  Status: ['ACTIVE', 'INACTIVE'],
}

describe('createBaseType', () => {
  it('creates z.string() for String', () => {
    const schema = createBaseType(field({ type: 'String' }), ENUM_MAP)
    expect(schema.parse('hello')).toBe('hello')
    expect(() => schema.parse(123)).toThrow()
  })

  it('creates z.number().int() for Int', () => {
    const schema = createBaseType(field({ type: 'Int' }), ENUM_MAP)
    expect(schema.parse(42)).toBe(42)
    expect(() => schema.parse(3.14)).toThrow()
    expect(() => schema.parse('a')).toThrow()
  })

  it('creates z.number() for Float', () => {
    const schema = createBaseType(field({ type: 'Float' }), ENUM_MAP)
    expect(schema.parse(3.14)).toBe(3.14)
    expect(schema.parse(42)).toBe(42)
    expect(() => schema.parse('a')).toThrow()
  })

  it('creates union for Decimal', () => {
    const schema = createBaseType(field({ type: 'Decimal' }), ENUM_MAP)
    expect(schema.parse(3.14)).toBe(3.14)
    expect(schema.parse('3.14')).toBe('3.14')
    expect(() => schema.parse('abc')).toThrow()
  })

  it('creates z.bigint() for BigInt', () => {
    const schema = createBaseType(field({ type: 'BigInt' }), ENUM_MAP)
    expect(schema.parse(BigInt(42))).toBe(BigInt(42))
    expect(() => schema.parse(42)).toThrow()
  })

  it('creates z.boolean() for Boolean', () => {
    const schema = createBaseType(field({ type: 'Boolean' }), ENUM_MAP)
    expect(schema.parse(true)).toBe(true)
    expect(schema.parse(false)).toBe(false)
    expect(() => schema.parse('true')).toThrow()
  })

  it('creates z.coerce.date() for DateTime', () => {
    const schema = createBaseType(field({ type: 'DateTime' }), ENUM_MAP)
    const d = schema.parse('2024-01-01')
    expect(d).toBeInstanceOf(Date)
  })

  it('creates z.unknown() for Json', () => {
    const schema = createBaseType(field({ type: 'Json' }), ENUM_MAP)
    expect(schema.parse({ a: 1 })).toEqual({ a: 1 })
    expect(schema.parse(null)).toBeNull()
    expect(schema.parse('str')).toBe('str')
  })

  it('creates union for Bytes', () => {
    const schema = createBaseType(field({ type: 'Bytes' }), ENUM_MAP)
    expect(schema.parse('base64data')).toBe('base64data')
    expect(schema.parse(new Uint8Array([1, 2]))).toEqual(new Uint8Array([1, 2]))
  })

  it('creates z.enum for enum field', () => {
    const schema = createBaseType(field({ type: 'Role', isEnum: true }), ENUM_MAP)
    expect(schema.parse('USER')).toBe('USER')
    expect(schema.parse('ADMIN')).toBe('ADMIN')
    expect(() => schema.parse('UNKNOWN')).toThrow()
  })

  it('wraps in z.array for isList', () => {
    const schema = createBaseType(field({ type: 'String', isList: true }), ENUM_MAP)
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b'])
    expect(() => schema.parse('a')).toThrow()
  })

  it('throws on unknown scalar type', () => {
    expect(() => createBaseType(field({ type: 'UnknownType' }), ENUM_MAP)).toThrow('Unknown scalar type')
  })

  it('throws on unknown enum type', () => {
    expect(() => createBaseType(field({ type: 'Missing', isEnum: true }), ENUM_MAP)).toThrow('Unknown enum')
  })
})

describe('createOperatorSchema', () => {
  describe('string operators', () => {
    const f = field({ type: 'String' })

    it.each(['equals', 'not', 'contains', 'startsWith', 'endsWith'])('creates string schema for %s', (op) => {
      const schema = createOperatorSchema(f, op, ENUM_MAP)
      expect(schema.parse('hello')).toBe('hello')
    })

    it.each(['in', 'notIn'])('creates string array schema for %s', (op) => {
      const schema = createOperatorSchema(f, op, ENUM_MAP)
      expect(schema.parse(['a', 'b'])).toEqual(['a', 'b'])
    })

    it('rejects unsupported operator', () => {
      expect(() => createOperatorSchema(f, 'gt', ENUM_MAP)).toThrow('not supported')
    })
  })

  describe('int operators', () => {
    const f = field({ type: 'Int' })

    it.each(['equals', 'not', 'gt', 'gte', 'lt', 'lte'])('creates int schema for %s', (op) => {
      const schema = createOperatorSchema(f, op, ENUM_MAP)
      expect(schema.parse(42)).toBe(42)
    })

    it.each(['in', 'notIn'])('creates int array schema for %s', (op) => {
      const schema = createOperatorSchema(f, op, ENUM_MAP)
      expect(schema.parse([1, 2])).toEqual([1, 2])
    })
  })

  describe('boolean operators', () => {
    const f = field({ type: 'Boolean' })

    it('creates boolean schema for equals', () => {
      const schema = createOperatorSchema(f, 'equals', ENUM_MAP)
      expect(schema.parse(true)).toBe(true)
    })

    it('rejects gt on boolean', () => {
      expect(() => createOperatorSchema(f, 'gt', ENUM_MAP)).toThrow('not supported')
    })
  })

  describe('nullable fields', () => {
    const f = field({ type: 'String', isRequired: false })

    it('allows null for equals on optional field', () => {
      const schema = createOperatorSchema(f, 'equals', ENUM_MAP)
      expect(schema.parse(null)).toBeNull()
      expect(schema.parse('hello')).toBe('hello')
    })

    it('allows null in array for in on optional field', () => {
      const schema = createOperatorSchema(f, 'in', ENUM_MAP)
      expect(schema.parse(['a', null])).toEqual(['a', null])
    })
  })

  describe('enum operators', () => {
    const f = field({ type: 'Role', isEnum: true })

    it('creates enum schema for equals', () => {
      const schema = createOperatorSchema(f, 'equals', ENUM_MAP)
      expect(schema.parse('USER')).toBe('USER')
      expect(() => schema.parse('UNKNOWN')).toThrow()
    })

    it('creates enum array schema for in', () => {
      const schema = createOperatorSchema(f, 'in', ENUM_MAP)
      expect(schema.parse(['USER', 'ADMIN'])).toEqual(['USER', 'ADMIN'])
    })

    it('rejects unsupported operator for enum', () => {
      expect(() => createOperatorSchema(f, 'gt', ENUM_MAP)).toThrow('not supported')
    })

    it('allows null for optional enum equals', () => {
      const optEnum = field({ type: 'Role', isEnum: true, isRequired: false })
      const schema = createOperatorSchema(optEnum, 'equals', ENUM_MAP)
      expect(schema.parse(null)).toBeNull()
    })
  })

  it('throws on unknown scalar type for operator', () => {
    expect(() => createOperatorSchema(field({ type: 'UnknownType' }), 'equals', ENUM_MAP)).toThrow()
  })
})