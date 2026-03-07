import { CallerError } from './errors.js'

export function matchCallerPattern(
  patterns: string[],
  caller: string,
): string | null {
  if (patterns.includes(caller)) return caller

  const matches: string[] = []

  for (const pattern of patterns) {
    if (!pattern.includes(':')) continue
    const patternParts = pattern.split('/')
    const callerParts = caller.split('/')
    if (patternParts.length !== callerParts.length) continue

    let ok = true
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) continue
      if (patternParts[i] !== callerParts[i]) {
        ok = false
        break
      }
    }
    if (ok) matches.push(pattern)
  }

  if (matches.length === 0) return null
  if (matches.length > 1) {
    throw new CallerError(
      `Ambiguous caller "${caller}" matches multiple patterns: ${matches.map(p => `"${p}"`).join(', ')}`,
    )
  }
  return matches[0]
}