import { describe, it, expect } from 'vitest'
import { validateDirective } from '../../src/generator/validate-directive.js'

describe('validateDirective', () => {
  describe('valid directives', () => {
    it.each([
      ['.min(1)'],
      ['.max(100)'],
      ['.email()'],
      ['.url()'],
      ['.uuid()'],
      ['.cuid()'],
      ['.cuid2()'],
      ['.ulid()'],
      ['.trim()'],
      ['.toLowerCase()'],
      ['.toUpperCase()'],
      ['.int()'],
      ['.positive()'],
      ['.nonnegative()'],
      ['.negative()'],
      ['.nonpositive()'],
      ['.finite()'],
      ['.safe()'],
      ['.nonempty()'],
      ['.datetime()'],
      ['.ip()'],
      ['.cidr()'],
      ['.date()'],
      ['.time()'],
      ['.duration()'],
      ['.base64()'],
      ['.nanoid()'],
      ['.emoji()'],
    ])('accepts single method: %s', (input) => {
      expect(validateDirective(input)).toMatchObject({ valid: true })
    })

    it.each([
      ['.min(1).max(100)'],
      ['.email().max(255)'],
      ['.min(1).max(100).trim()'],
      ['.int().positive()'],
      ['.gt(0).lt(100)'],
      ['.gte(0).lte(100)'],
    ])('accepts chained methods: %s', (input) => {
      expect(validateDirective(input)).toMatchObject({ valid: true })
    })

    it.each([
      ['.min(0)'],
      ['.min(-1)'],
      ['.min(3.14)'],
      ['.min(-3.14)'],
      ['.min(1e2)'],
      ['.min(1e-2)'],
      ['.min(1e+2)'],
    ])('accepts numeric args: %s', (input) => {
      expect(validateDirective(input)).toMatchObject({ valid: true })
    })

    it.each([
      [".startsWith('hello')"],
      ['.startsWith("hello")'],
      ['.endsWith("world")'],
      ['.includes("test")'],
    ])('accepts string args: %s', (input) => {
      expect(validateDirective(input)).toMatchObject({ valid: true })
    })

    it.each([
      ['.multipleOf(5)'],
      ['.step(0.1)'],
      ['.length(10)'],
    ])('accepts single numeric arg methods: %s', (input) => {
      expect(validateDirective(input)).toMatchObject({ valid: true })
    })

    it('accepts boolean true arg', () => {
      expect(validateDirective('.nonempty(true)')).toMatchObject({ valid: true })
    })

    it('accepts boolean false arg', () => {
      expect(validateDirective('.nonempty(false)')).toMatchObject({ valid: true })
    })

    it('rejects null arg', () => {
      const r = validateDirective('.nonempty(null)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('null')
    })

    it('accepts array arg', () => {
      expect(validateDirective('.min([1, 2, 3])')).toMatchObject({ valid: true })
    })

    it('accepts empty array arg', () => {
      expect(validateDirective('.min([])')).toMatchObject({ valid: true })
    })

    it('accepts array with mixed types (no null)', () => {
      expect(validateDirective(".min([1, 'a', true])")).toMatchObject({ valid: true })
    })

    it('rejects array with null element', () => {
      const r = validateDirective(".min([1, 'a', true, null])")
      expect(r.valid).toBe(false)
    })

    it('accepts whitespace between calls', () => {
      expect(validateDirective('.min(1) .max(100)')).toMatchObject({ valid: true })
    })

    it('accepts multiple args', () => {
      expect(validateDirective('.min(1, "error")')).toMatchObject({ valid: true })
    })

    it('accepts escaped quotes in strings', () => {
      expect(validateDirective('.startsWith("he\\"llo")')).toMatchObject({ valid: true })
    })

    it('accepts escaped single quotes', () => {
      expect(validateDirective(".startsWith('he\\'llo')")).toMatchObject({ valid: true })
    })

    it('returns parsed method names on valid result', () => {
      const r = validateDirective('.min(1).max(100).trim()')
      expect(r).toEqual({ valid: true, methods: ['min', 'max', 'trim'] })
    })

    it('accepts nullable', () => {
      const r = validateDirective('.nullable()')
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['nullable'] })
    })

    it('accepts optional', () => {
      const r = validateDirective('.optional()')
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['optional'] })
    })

    it('accepts nullish', () => {
      const r = validateDirective('.nullish()')
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['nullish'] })
    })

    it('accepts readonly', () => {
      const r = validateDirective('.readonly()')
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['readonly'] })
    })

    it('accepts default with string arg', () => {
      const r = validateDirective(".default('active')")
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['default'] })
    })

    it('accepts default with number arg', () => {
      const r = validateDirective('.default(0)')
      expect(r.valid).toBe(true)
    })

    it('accepts catch with value', () => {
      const r = validateDirective(".catch('fallback')")
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['catch'] })
    })

    it('accepts regex with simple pattern', () => {
      const r = validateDirective('.regex(/^[a-z]+$/)')
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['regex'] })
    })

    it('accepts regex with flags', () => {
      const r = validateDirective('.regex(/^[A-Z]+$/i)')
      expect(r.valid).toBe(true)
    })

    it('accepts regex with error message', () => {
      const r = validateDirective('.regex(/^\\d+$/, "digits only")')
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['regex'] })
    })

    it('accepts object literal arg', () => {
      const r = validateDirective('.datetime({offset: true})')
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['datetime'] })
    })

    it('accepts object with string keys', () => {
      const r = validateDirective('.ip({"version": "v4"})')
      expect(r.valid).toBe(true)
    })

    it('accepts empty object arg', () => {
      const r = validateDirective('.datetime({})')
      expect(r.valid).toBe(true)
    })

    it('accepts chained with new methods', () => {
      const r = validateDirective('.min(1).max(100).nullable().default(0)')
      expect(r.valid).toBe(true)
      expect(r).toEqual({ valid: true, methods: ['min', 'max', 'nullable', 'default'] })
    })
  })

  describe('invalid directives', () => {
    it('rejects empty string', () => {
      const r = validateDirective('')
      expect(r.valid).toBe(false)
    })

    it('rejects missing leading dot', () => {
      const r = validateDirective('min(1)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('"."')
    })

    it('rejects unknown method', () => {
      const r = validateDirective('.transform()')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('Unknown zod method')
    })

    it('rejects default without args', () => {
      const r = validateDirective('.default()')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('expects 1 argument')
    })

    it('rejects catch without args', () => {
      const r = validateDirective('.catch()')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('expects 1 argument')
    })

    it('rejects template literal arg', () => {
      const r = validateDirective('.min(`hello`)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('Template literal')
    })

    it('rejects identifier arg', () => {
      const r = validateDirective('.min(someVar)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('Identifier')
    })

    it('rejects NaN', () => {
      const r = validateDirective('.min(NaN)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('NaN')
    })

    it('rejects Infinity', () => {
      const r = validateDirective('.min(Infinity)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('Infinity')
    })

    it('rejects + prefix on number', () => {
      const r = validateDirective('.min(+1)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('"+"')
    })

    it('accepts + in exponent', () => {
      const r = validateDirective('.min(1e+2)')
      expect(r.valid).toBe(true)
    })

    it('rejects missing parens', () => {
      const r = validateDirective('.min')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('"("')
    })

    it('rejects unclosed parens', () => {
      const r = validateDirective('.min(1')
      expect(r.valid).toBe(false)
    })

    it('rejects unterminated string', () => {
      const r = validateDirective('.startsWith("hello)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('Unterminated')
    })

    it('rejects control character in string', () => {
      const r = validateDirective('.startsWith("he\x01llo")')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('Control character')
    })

    it('rejects invalid escape in string', () => {
      const r = validateDirective('.startsWith("he\\nllo")')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('Invalid escape')
    })

    it('rejects unclosed array', () => {
      const r = validateDirective('.min([1, 2')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('"]"')
    })

    it('rejects invalid number after decimal', () => {
      const r = validateDirective('.min(1.)')
      expect(r.valid).toBe(false)
    })

    it('rejects invalid exponent', () => {
      const r = validateDirective('.min(1e)')
      expect(r.valid).toBe(false)
    })

    it('rejects directive exceeding max length', () => {
      const long = '.min(' + '1'.repeat(1025) + ')'
      const r = validateDirective(long)
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('maximum length')
    })

    it('rejects directive exceeding max chain depth', () => {
      const chain = '.min(1)'.repeat(21)
      const r = validateDirective(chain)
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('maximum chain depth')
    })

    it('rejects dot without method name', () => {
      const r = validateDirective('.min(1).()')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('method name')
    })

    it('rejects closing brace as arg', () => {
      const r = validateDirective('.min(})')
      expect(r.valid).toBe(false)
    })

    it('rejects bare dot only', () => {
      const r = validateDirective('.')
      expect(r.valid).toBe(false)
    })

    it('rejects null as argument', () => {
      const r = validateDirective('.min(null)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('null')
    })

    it('rejects unterminated regex', () => {
      const r = validateDirective('.regex(/abc)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('Unterminated regex')
    })

    it('rejects unclosed object', () => {
      const r = validateDirective('.datetime({offset: true)')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('"}"')
    })

    it('rejects object with missing colon', () => {
      const r = validateDirective('.datetime({offset true})')
      expect(r.valid).toBe(false)
      expect(r.valid === false && r.reason).toContain('":"')
    })
  })
})