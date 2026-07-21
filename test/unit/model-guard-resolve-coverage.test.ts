import { describe, it, expect } from 'vitest'
import { resolveShape } from '../../src/runtime/model-guard-resolve.js'
import { CallerError, ShapeError } from '../../src/shared/errors.js'

const context = () => ({ role: 'admin' })

describe('model-guard-resolve uncovered branches', () => {
  it('normalizes null and undefined bodies for static shapes', () => {
    expect(resolveShape({}, null, context, undefined)).toEqual({
      shape: {},
      body: {},
      matchedKey: '_default',
      wasDynamic: false,
    })
    expect(resolveShape({}, undefined, context, undefined).body).toEqual({})
  })

  it('wraps dynamic shape exceptions', () => {
    const cause = new Error('boom')
    expect(() =>
      resolveShape(
        () => {
          throw cause
        },
        {},
        context,
        undefined,
      ),
    ).toThrow('Dynamic shape function threw: boom')

    try {
      resolveShape(
        () => {
          throw cause
        },
        {},
        context,
        undefined,
      )
    } catch (error) {
      expect(error).toBeInstanceOf(ShapeError)
      expect((error as Error & { cause?: unknown }).cause).toBe(cause)
    }
  })

  it('rejects invalid dynamic shape results', () => {
    expect(() =>
      resolveShape(() => ({ invalid: true }) as any, {}, context, undefined),
    ).toThrow('must return a valid guard shape object')
  })

  it('rejects reserved keys in a named shape map', () => {
    expect(() =>
      resolveShape(
        {
          data: {} as any,
          '/admin': {},
        } as any,
        {},
        context,
        '/admin',
      ),
    ).toThrow('collides with reserved guard shape key')
  })

  it('rejects ambiguous caller patterns', () => {
    expect(() =>
      resolveShape(
        {
          '/org/:orgId/users': {},
          '/:type/:id/users': {},
        },
        {},
        context,
        '/org/123/users',
      ),
    ).toThrow(CallerError)

    expect(() =>
      resolveShape(
        {
          '/org/:orgId/users': {},
          '/:type/:id/users': {},
        },
        {},
        context,
        '/org/123/users',
      ),
    ).toThrow('matches multiple patterns')
  })

  it('rejects invalid guard input and non-plain bodies', () => {
    expect(() => resolveShape(42 as any, {}, context, undefined)).toThrow(
      'Guard input must be a shape object or a named map of shapes',
    )
    expect(() => resolveShape({}, [], context, undefined)).toThrow(
      'Request body must be a plain object',
    )
  })

  it('resolves named dynamic entries and reports matched metadata', () => {
    const result = resolveShape(
      {
        '/admin': (ctx: { role: string }) => ({
          data: ctx.role === 'admin' ? { name: true } : {},
        }),
      },
      { data: { name: 'A' } },
      context,
      '/admin',
    )

    expect(result).toEqual({
      shape: { data: { name: true } },
      body: { data: { name: 'A' } },
      matchedKey: '/admin',
      wasDynamic: true,
    })
  })
})
