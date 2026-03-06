import { describe, it, expect } from 'vitest'
import { validateDirective } from '../../src/generator/validate-directive.js'

function expectInvalid(raw: string, pattern: RegExp) {
  const result = validateDirective(raw)
  expect(result.valid).toBe(false)
  if (!result.valid) {
    expect(result.reason).toMatch(pattern)
  }
}

describe('validate-directive coverage: uncovered error branches', () => {
  it('rejects invalid escape sequence in string', () => {
    expectInvalid('.min("hello\\nworld")', /escape sequence/)
  })

  it('rejects backslash at end of string', () => {
    const result = validateDirective('.min("trailing\\')
    expect(result.valid).toBe(false)
  })

  it('rejects exponent with + sign', () => {
    expectInvalid('.min(1e+2)', /\+/)
  })

  it('rejects NaN as argument', () => {
    expectInvalid('.min(NaN)', /NaN/)
  })

  it('rejects Infinity as argument', () => {
    expectInvalid('.min(Infinity)', /Infinity/)
  })

  it('rejects + prefix on numbers', () => {
    expectInvalid('.min(+1)', /\+/)
  })

  it('rejects identifier as argument value', () => {
    expectInvalid('.min(someVar)', /[Ii]dentifier/)
  })

  it('rejects object literal in args', () => {
    expectInvalid('.min({})', /[Oo]bject literal/)
  })

  it('rejects closing brace in args', () => {
    expectInvalid('.min(})', /[Oo]bject literal/)
  })

  it('rejects template literal in args', () => {
    expectInvalid('.min(`template`)', /[Tt]emplate literal/)
  })

  it('rejects control character outside strings', () => {
    expectInvalid('.min(\x01)', /[Cc]ontrol character/)
  })

  it('rejects control character inside strings', () => {
    expectInvalid('.min("\x01")', /[Cc]ontrol character/)
  })

  it('rejects unexpected character', () => {
    expectInvalid('.min(@)', /[Uu]nexpected character/)
  })

  it('rejects unclosed array', () => {
    expectInvalid('.min([1, 2)', /\]/)
  })

  it('rejects number with trailing dot and no digits', () => {
    expectInvalid('.min(1.)', /digit after decimal/)
  })

  it('rejects exponent with no digits', () => {
    expectInvalid('.min(1e)', /digit in exponent/)
  })

  it('rejects identifier starting with underscore', () => {
    expectInvalid('.min(_private)', /[Ii]dentifier/)
  })

  it('handles empty array in args', () => {
    const result = validateDirective('.min([])')
    expect(result.valid).toBe(true)
  })

  it('rejects negative sign alone as number', () => {
    const result = validateDirective('.min(-)')
    expect(result.valid).toBe(false)
  })

  it('valid: negative number in exponent', () => {
    const result = validateDirective('.min(1e-2)')
    expect(result.valid).toBe(true)
  })

  it('valid: escaped quote in string', () => {
    const result = validateDirective(".startsWith('\\'')")
    expect(result.valid).toBe(true)
  })
})