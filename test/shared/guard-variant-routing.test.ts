import { describe, expect, it } from 'vitest'
import {
  resolveGuardVariantKey,
  type GuardVariantResolution,
} from '../../src/shared/guard-variant-routing.js'

const reservedKeys = new Set(['where', 'data', 'select', 'include'])

function named(keys: string[], caller?: string): GuardVariantResolution {
  return resolveGuardVariantKey({
    kind: 'named',
    keys,
    caller,
    reservedKeys,
  })
}

describe('resolveGuardVariantKey', () => {
  it('resolves a single shape to _default', () => {
    expect(resolveGuardVariantKey({ kind: 'single' })).toEqual({
      ok: true,
      key: '_default',
    })
  })

  it('reports the first reserved-key collision', () => {
    expect(named(['where', 'customer'], 'customer')).toMatchObject({
      ok: false,
      code: 'reserved-key',
      key: 'where',
    })
  })

  it('uses default when caller is missing', () => {
    expect(named(['customer', 'default'])).toEqual({
      ok: true,
      key: 'default',
    })
  })

  it('reports missing-caller when caller is not a string', () => {
    expect(named(['customer'])).toMatchObject({
      ok: false,
      code: 'missing-caller',
    })
  })

  it('uses default for a blank caller without matching a blank key', () => {
    expect(named(['', 'customer', 'default'], '')).toEqual({
      ok: true,
      key: 'default',
    })
  })

  it('reports unknown-caller for a blank caller without default', () => {
    expect(named(['', 'customer'], '')).toMatchObject({
      ok: false,
      code: 'unknown-caller',
      caller: '',
    })
  })

  it('treats whitespace-only caller as blank', () => {
    expect(named(['customer'], '   ')).toMatchObject({
      ok: false,
      code: 'unknown-caller',
      caller: '   ',
    })
  })

  it('prefers an exact match over parameterized matches', () => {
    expect(
      named(['customer/123', 'customer/:customerId'], 'customer/123'),
    ).toEqual({
      ok: true,
      key: 'customer/123',
    })
  })

  it('resolves one parameterized match', () => {
    expect(named(['customer/:customerId'], 'customer/123')).toEqual({
      ok: true,
      key: 'customer/:customerId',
    })
  })

  it('reports all ambiguous parameterized matches', () => {
    expect(named(['a/:value', ':prefix/b'], 'a/b')).toMatchObject({
      ok: false,
      code: 'ambiguous-caller',
      caller: 'a/b',
      matches: ['a/:value', ':prefix/b'],
    })
  })

  it('uses default when a non-blank caller is unmatched', () => {
    expect(named(['customer', 'default'], 'seller')).toEqual({
      ok: true,
      key: 'default',
    })
  })

  it('reports unknown-caller when no key or default matches', () => {
    expect(named(['customer'], 'seller')).toMatchObject({
      ok: false,
      code: 'unknown-caller',
      caller: 'seller',
    })
  })
})
