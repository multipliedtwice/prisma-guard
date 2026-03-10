const ALLOWED_ZOD_METHODS = new Set([
  'min', 'max', 'length', 'email', 'url', 'uuid', 'cuid', 'cuid2',
  'ulid', 'trim', 'toLowerCase', 'toUpperCase',
  'startsWith', 'endsWith', 'includes',
  'datetime', 'ip', 'cidr', 'date', 'time', 'duration',
  'base64', 'nanoid', 'emoji',
  'int', 'positive', 'nonnegative', 'negative', 'nonpositive',
  'finite', 'safe', 'multipleOf', 'step',
  'gt', 'gte', 'lt', 'lte',
  'nonempty',
  'regex',
  'readonly',
  'optional', 'nullable', 'nullish',
  'default', 'catch',
])

const METHOD_ARITY: Record<string, [number, number]> = {
  min: [1, 2], max: [1, 2], length: [1, 2],
  email: [0, 1], url: [0, 1], uuid: [0, 1], cuid: [0, 1], cuid2: [0, 1], ulid: [0, 1],
  trim: [0, 0], toLowerCase: [0, 0], toUpperCase: [0, 0],
  startsWith: [1, 2], endsWith: [1, 2], includes: [1, 2],
  datetime: [0, 1], ip: [0, 1], cidr: [0, 1], date: [0, 1], time: [0, 1], duration: [0, 1],
  base64: [0, 1], nanoid: [0, 1], emoji: [0, 1],
  int: [0, 1], positive: [0, 1], nonnegative: [0, 1], negative: [0, 1], nonpositive: [0, 1],
  finite: [0, 1], safe: [0, 1],
  multipleOf: [1, 2], step: [1, 2],
  gt: [1, 2], gte: [1, 2], lt: [1, 2], lte: [1, 2],
  nonempty: [0, 1],
  regex: [1, 2],
  readonly: [0, 0],
  optional: [0, 0], nullable: [0, 0], nullish: [0, 0],
  default: [1, 1], catch: [1, 1],
}

const MAX_DIRECTIVE_LENGTH = 1024
const MAX_CHAIN_DEPTH = 20

type ValidationResult =
  | { valid: true; methods: string[] }
  | { valid: false; reason: string }

export function validateDirective(raw: string): ValidationResult {
  if (raw.length > MAX_DIRECTIVE_LENGTH) {
    return { valid: false, reason: 'Directive exceeds maximum length' }
  }

  const input = raw.trim()
  if (input.length === 0) {
    return { valid: false, reason: 'Empty directive' }
  }
  if (input[0] !== '.') {
    return { valid: false, reason: 'Directive must start with "."' }
  }

  let pos = 0
  let chainCount = 0
  const methods: string[] = []

  function peek(): string {
    return input[pos] ?? ''
  }

  function advance(): string {
    return input[pos++] ?? ''
  }

  function skipWhitespace(): void {
    while (pos < input.length && (input[pos] === ' ' || input[pos] === '\t')) {
      pos++
    }
  }

  function parseString(): ValidationResult | null {
    const quote = peek()
    if (quote !== '"' && quote !== "'") return null
    advance()
    while (pos < input.length) {
      const ch = input[pos]
      if (ch === '\\') {
        const next = input[pos + 1]
        if (next === "'" || next === '"' || next === '\\') {
          pos += 2
          continue
        }
        return { valid: false, reason: `Invalid escape sequence "\\${next ?? ''}" in string` }
      }
      if (ch === quote) {
        advance()
        return null
      }
      if (ch.charCodeAt(0) < 32) {
        return { valid: false, reason: 'Control character in string' }
      }
      advance()
    }
    return { valid: false, reason: 'Unterminated string' }
  }

  function parseNumber(): ValidationResult | null {
    const start = pos
    if (peek() === '-') advance()
    if (pos >= input.length || !/[0-9]/.test(peek())) {
      pos = start
      return null
    }
    if (peek() === '0' && pos + 1 < input.length && /[0-9]/.test(input[pos + 1])) {
      return { valid: false, reason: 'Leading zeros not allowed in numbers' }
    }
    while (pos < input.length && /[0-9]/.test(peek())) advance()
    if (peek() === '.') {
      advance()
      if (!/[0-9]/.test(peek())) {
        return { valid: false, reason: 'Invalid number: expected digit after decimal point' }
      }
      while (pos < input.length && /[0-9]/.test(peek())) advance()
    }
    if (peek() === 'e' || peek() === 'E') {
      advance()
      if (peek() === '-') advance()
      if (peek() === '+') {
        return { valid: false, reason: 'Invalid number: "+" not allowed in exponent' }
      }
      if (!/[0-9]/.test(peek())) {
        return { valid: false, reason: 'Invalid number: expected digit in exponent' }
      }
      while (pos < input.length && /[0-9]/.test(peek())) advance()
    }
    return null
  }

  function parseRegex(): ValidationResult | null {
    advance()
    if (peek() === '/' || peek() === '*') {
      return { valid: false, reason: 'Empty or comment-like regex pattern' }
    }
    let inCharClass = false
    while (pos < input.length) {
      const ch = input[pos]
      if (ch === '\\') {
        if (pos + 1 >= input.length) {
          return { valid: false, reason: 'Unterminated escape in regex' }
        }
        pos += 2
        continue
      }
      if (ch === '[' && !inCharClass) {
        inCharClass = true
        pos++
        continue
      }
      if (ch === ']' && inCharClass) {
        inCharClass = false
        pos++
        continue
      }
      if (ch === '/' && !inCharClass) {
        advance()
        while (pos < input.length && /[gimsuydv]/.test(peek())) {
          advance()
        }
        return null
      }
      if (ch.charCodeAt(0) < 32 && ch !== '\t') {
        return { valid: false, reason: 'Control character in regex' }
      }
      pos++
    }
    return { valid: false, reason: 'Unterminated regex literal' }
  }

  function parseObjectKey(): ValidationResult | null {
    skipWhitespace()
    const ch = peek()
    if (ch === '"' || ch === "'") {
      return parseString()
    }
    if (/[a-zA-Z_]/.test(ch)) {
      while (pos < input.length && /[a-zA-Z0-9_]/.test(peek())) {
        advance()
      }
      return null
    }
    return { valid: false, reason: 'Expected object key (identifier or string)' }
  }

  function parseArg(): ValidationResult | null {
    skipWhitespace()
    const ch = peek()

    if (ch === '}') {
      return { valid: false, reason: 'Unexpected "}" in directive args' }
    }
    if (ch === '`') {
      return { valid: false, reason: 'Template literals not allowed in directive args' }
    }
    if (ch !== '' && ch.charCodeAt(0) < 32) {
      return { valid: false, reason: 'Control character not allowed outside strings' }
    }

    if (ch === '"' || ch === "'") {
      return parseString()
    }

    if (ch === '/') {
      return parseRegex()
    }

    if (ch === '{') {
      advance()
      skipWhitespace()
      if (peek() === '}') {
        advance()
        return null
      }
      const keyErr = parseObjectKey()
      if (keyErr) return keyErr
      skipWhitespace()
      if (peek() !== ':') {
        return { valid: false, reason: 'Expected ":" after object key' }
      }
      advance()
      const valErr = parseArg()
      if (valErr) return valErr
      skipWhitespace()
      while (peek() === ',') {
        advance()
        skipWhitespace()
        if (peek() === '}') break
        const nextKeyErr = parseObjectKey()
        if (nextKeyErr) return nextKeyErr
        skipWhitespace()
        if (peek() !== ':') {
          return { valid: false, reason: 'Expected ":" after object key' }
        }
        advance()
        const nextValErr = parseArg()
        if (nextValErr) return nextValErr
        skipWhitespace()
      }
      if (peek() !== '}') {
        return { valid: false, reason: 'Expected "}" to close object' }
      }
      advance()
      return null
    }

    if (ch === '[') {
      advance()
      skipWhitespace()
      if (peek() === ']') {
        advance()
        return null
      }
      const firstErr = parseArg()
      if (firstErr) return firstErr
      skipWhitespace()
      while (peek() === ',') {
        advance()
        skipWhitespace()
        if (peek() === ']') break
        const elemErr = parseArg()
        if (elemErr) return elemErr
        skipWhitespace()
      }
      if (peek() !== ']') {
        return { valid: false, reason: 'Expected "]" to close array' }
      }
      advance()
      return null
    }

    if (ch === '-' || /[0-9]/.test(ch)) {
      return parseNumber()
    }

    if (input.startsWith('true', pos)) {
      const after = input[pos + 4]
      if (!after || !/[a-zA-Z0-9_]/.test(after)) {
        pos += 4
        return null
      }
    }
    if (input.startsWith('false', pos)) {
      const after = input[pos + 5]
      if (!after || !/[a-zA-Z0-9_]/.test(after)) {
        pos += 5
        return null
      }
    }

    if (input.startsWith('NaN', pos)) {
      return { valid: false, reason: 'NaN not allowed' }
    }
    if (input.startsWith('Infinity', pos)) {
      return { valid: false, reason: 'Infinity not allowed' }
    }
    if (input.startsWith('null', pos)) {
      return { valid: false, reason: 'null not allowed as argument value' }
    }
    if (ch === '+') {
      return { valid: false, reason: '"+" prefix not allowed on numbers' }
    }

    if (/[a-zA-Z_]/.test(ch)) {
      return { valid: false, reason: 'Identifiers not allowed as argument values' }
    }

    return { valid: false, reason: `Unexpected character "${ch}"` }
  }

  while (pos < input.length) {
    skipWhitespace()
    if (pos >= input.length) break

    if (peek() !== '.') {
      return { valid: false, reason: `Expected "." at position ${pos}, got "${peek()}"` }
    }
    advance()

    if (!/[a-zA-Z_]/.test(peek())) {
      return { valid: false, reason: `Expected method name after "." at position ${pos}` }
    }

    let ident = ''
    while (pos < input.length && /[a-zA-Z0-9_]/.test(peek())) {
      ident += advance()
    }

    if (!ALLOWED_ZOD_METHODS.has(ident)) {
      return { valid: false, reason: `Unknown zod method: ${ident}` }
    }

    skipWhitespace()

    if (peek() !== '(') {
      return { valid: false, reason: `Expected "(" after method "${ident}"` }
    }
    advance()

    skipWhitespace()

    let argCount = 0
    if (peek() !== ')') {
      const argErr = parseArg()
      if (argErr) return argErr
      argCount = 1
      skipWhitespace()
      while (peek() === ',') {
        advance()
        skipWhitespace()
        if (peek() === ')') break
        const nextArgErr = parseArg()
        if (nextArgErr) return nextArgErr
        argCount++
        skipWhitespace()
      }
    }

    if (peek() !== ')') {
      return { valid: false, reason: `Expected ")" to close method "${ident}"` }
    }
    advance()

    const arity = METHOD_ARITY[ident]
    if (arity) {
      const [minArgs, maxArgs] = arity
      if (argCount < minArgs || argCount > maxArgs) {
        if (minArgs === maxArgs) {
          return { valid: false, reason: `Method "${ident}" expects ${minArgs} argument(s), got ${argCount}` }
        }
        return { valid: false, reason: `Method "${ident}" expects ${minArgs}-${maxArgs} arguments, got ${argCount}` }
      }
    }

    methods.push(ident)
    chainCount++
    if (chainCount > MAX_CHAIN_DEPTH) {
      return { valid: false, reason: 'Directive exceeds maximum chain depth' }
    }
  }

  if (chainCount === 0) {
    return { valid: false, reason: 'No method calls found' }
  }

  return { valid: true, methods }
}