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
])

const MAX_DIRECTIVE_LENGTH = 1024
const MAX_CHAIN_DEPTH = 20

type ValidationResult =
  | { valid: true }
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
        if (next === "'" || next === '"') {
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

  function parseArg(): ValidationResult | null {
    skipWhitespace()
    const ch = peek()

    if (ch === '{' || ch === '}') {
      return { valid: false, reason: 'Object literals not allowed in directive args' }
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
    if (input.startsWith('null', pos)) {
      const after = input[pos + 4]
      if (!after || !/[a-zA-Z0-9_]/.test(after)) {
        pos += 4
        return null
      }
    }

    if (input.startsWith('NaN', pos)) {
      return { valid: false, reason: 'NaN not allowed' }
    }
    if (input.startsWith('Infinity', pos)) {
      return { valid: false, reason: 'Infinity not allowed' }
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

    if (peek() !== ')') {
      const argErr = parseArg()
      if (argErr) return argErr
      skipWhitespace()
      while (peek() === ',') {
        advance()
        const nextArgErr = parseArg()
        if (nextArgErr) return nextArgErr
        skipWhitespace()
      }
    }

    if (peek() !== ')') {
      return { valid: false, reason: `Expected ")" to close method "${ident}"` }
    }
    advance()

    chainCount++
    if (chainCount > MAX_CHAIN_DEPTH) {
      return { valid: false, reason: 'Directive exceeds maximum chain depth' }
    }
  }

  if (chainCount === 0) {
    return { valid: false, reason: 'No method calls found' }
  }

  return { valid: true }
}