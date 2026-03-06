import { createGuard } from 'prisma-guard'
import {
  SCOPE_MAP, TYPE_MAP, ENUM_MAP, ZOD_CHAINS, GUARD_CONFIG,
} from './generated/guard/index.js'
import type { ScopeRoot } from './generated/guard/index.js'

const guard = createGuard<typeof TYPE_MAP, ScopeRoot>({
  scopeMap: SCOPE_MAP,
  typeMap: TYPE_MAP,
  enumMap: ENUM_MAP,
  zodChains: ZOD_CHAINS,
  guardConfig: GUARD_CONFIG,
})

const createUser = guard.input('User', {
  mode: 'create',
  pick: ['email', 'name'],
})

const parsed = createUser.parse({ email: 'test@example.com', name: 'Test' })
if (parsed.email !== 'test@example.com') throw new Error('Input parse mismatch')
console.log('input.parse OK')

let inputFailed = false
try {
  createUser.parse({ email: 'not-an-email', name: 'Test' })
} catch {
  inputFailed = true
}
if (!inputFailed) throw new Error('@zod .email() did not reject invalid input')
console.log('input @zod validation OK')

const userOutput = guard.model('User', {
  pick: ['id', 'email', 'name'],
})
const outputParsed = userOutput.parse({
  id: '123',
  email: 'not-an-email-but-legacy-data',
  name: null,
})
if (outputParsed.email !== 'not-an-email-but-legacy-data') {
  throw new Error('Model schema should accept base types without @zod chains')
}
console.log('model.parse OK (no @zod chain leakage)')

const findUsers = guard.query('User', 'findMany', {
  where: {
    email: { contains: true },
  },
  distinct: ['email', 'name'],
  take: { max: 50, default: 20 },
})

const queryArgs = findUsers.parse({
  where: { email: { contains: 'test' } },
  distinct: ['email'],
  take: 10,
})
if ((queryArgs.take as number) !== 10) throw new Error('take mismatch')
console.log('query.parse OK (with distinct)')

if (GUARD_CONFIG.findUniqueMode !== 'reject') {
  throw new Error('Expected findUniqueMode to be "reject"')
}
console.log('GUARD_CONFIG.findUniqueMode OK')

console.log('smoke test passed')