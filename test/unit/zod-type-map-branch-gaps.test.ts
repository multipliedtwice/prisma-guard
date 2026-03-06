import { describe, it, expect } from 'vitest'
import type { FieldMeta, EnumMap } from '../../src/shared/types.js'
import { ShapeError } from '../../src/shared/errors.js'
import { createOperatorSchema, createBaseType } from '../../src/runtime/zod-type-map.js'

const enumMap: EnumMap = {
  Role: ['ADMIN', 'USER'],
}

const emptyEnumMap: EnumMap = {}

const enumMapEmpty: EnumMap = {
  EmptyEnum: [],
}

function enumField(type = 'Role'): FieldMeta {
  return {
    type,
    isList: false,
    isRequired: true,
    isId: false,
    isRelation: false,
    hasDefault: false,
    isUpdatedAt: false,
    isEnum: true,
  }
}

function scalarField(type: string): FieldMeta {
  return {
    type,
    isList: false,
    isRequired: true,
    isId: false,
    isRelation: false,
    hasDefault: false,
    isUpdatedAt: false,
  }
}

describe('zod-type-map branch gaps', () => {
  describe('createOperatorSchema: unknown enum in enumMap', () => {
    it('throws ShapeError when enum type not in enumMap', () => {
      expect(() =>
        createOperatorSchema(enumField('NonExistent'), 'equals', emptyEnumMap),
      ).toThrow(ShapeError)
    })

    it('throws ShapeError when enum has empty values array', () => {
      expect(() =>
        createOperatorSchema(enumField('EmptyEnum'), 'equals', enumMapEmpty),
      ).toThrow(ShapeError)
    })
  })

  describe('createOperatorSchema: unsupported operator for enum', () => {
    it('throws ShapeError for gt on enum field', () => {
      expect(() =>
        createOperatorSchema(enumField(), 'gt', enumMap),
      ).toThrow(ShapeError)
    })

    it('throws ShapeError for lt on enum field', () => {
      expect(() =>
        createOperatorSchema(enumField(), 'lt', enumMap),
      ).toThrow(ShapeError)
    })

    it('throws ShapeError for contains on enum field', () => {
      expect(() =>
        createOperatorSchema(enumField(), 'contains', enumMap),
      ).toThrow(ShapeError)
    })
  })

  describe('createOperatorSchema: unknown scalar type', () => {
    it('throws ShapeError for unknown scalar type', () => {
      expect(() =>
        createOperatorSchema(scalarField('CustomType'), 'equals', enumMap),
      ).toThrow(ShapeError)
    })

    it('throws ShapeError for Json type in operator schema', () => {
      expect(() =>
        createOperatorSchema(scalarField('Json'), 'equals', enumMap),
      ).toThrow(ShapeError)
    })
  })

  describe('createOperatorSchema: unsupported operator for scalar', () => {
    it('throws ShapeError for contains on Int', () => {
      expect(() =>
        createOperatorSchema(scalarField('Int'), 'contains', enumMap),
      ).toThrow(ShapeError)
    })

    it('throws ShapeError for startsWith on Boolean', () => {
      expect(() =>
        createOperatorSchema(scalarField('Boolean'), 'startsWith', enumMap),
      ).toThrow(ShapeError)
    })
  })

  describe('createBaseType: unknown scalar type', () => {
    it('throws ShapeError for unknown scalar type', () => {
      expect(() =>
        createBaseType(scalarField('Unknown'), enumMap),
      ).toThrow(ShapeError)
    })
  })

  describe('createBaseType: unknown enum', () => {
    it('throws ShapeError when enum not in map', () => {
      expect(() =>
        createBaseType(enumField('Missing'), emptyEnumMap),
      ).toThrow(ShapeError)
    })
  })
})