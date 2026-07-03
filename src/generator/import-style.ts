import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { getTsconfig } from 'get-tsconfig'

export type ImportStyle = 'none' | 'js' | 'ts'
export type ImportStyleConfig = 'auto' | ImportStyle
export type PrismaClientKind = 'prisma-client-js' | 'prisma-client' | 'package'

const NODE_ESM_MODES = new Set(['node16', 'node18', 'nodenext'])
const NO_EXTENSION_RESOLUTIONS = new Set(['bundler', 'classic', 'node', 'node10'])

interface TsCompilerOptions {
  module?: string
  moduleResolution?: string
  allowImportingTsExtensions?: boolean
}

function findUpwards(startDir: string, filename: string): string | null {
  let dir = resolve(startDir)
  while (true) {
    const candidate = join(dir, filename)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readCompilerOptions(startDir: string): TsCompilerOptions {
  try {
    const result = getTsconfig(startDir)
    if (!result) return {}
    const co = result.config.compilerOptions
    if (!co || typeof co !== 'object') return {}
    return co as TsCompilerOptions
  } catch {
    return {}
  }
}

function readPackageType(startDir: string): string | null {
  const pkgPath = findUpwards(startDir, 'package.json')
  if (!pkgPath) return null

  try {
    const raw = readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw)
    return typeof pkg.type === 'string' ? pkg.type : null
  } catch {
    return null
  }
}

export function resolveImportStyle(
  startDir: string,
  override: ImportStyleConfig,
): ImportStyle {
  if (override !== 'auto') return override

  const co = readCompilerOptions(startDir)

  if (co.allowImportingTsExtensions === true) return 'ts'

  const moduleValue =
    typeof co.module === 'string' ? co.module.toLowerCase() : ''
  const resolutionValue =
    typeof co.moduleResolution === 'string'
      ? co.moduleResolution.toLowerCase()
      : ''

  if (NODE_ESM_MODES.has(moduleValue) || NODE_ESM_MODES.has(resolutionValue)) {
    return 'js'
  }

  if (NO_EXTENSION_RESOLUTIONS.has(resolutionValue)) {
    return 'none'
  }

  if (readPackageType(startDir) === 'module') return 'js'

  return 'none'
}

export function withImportStyle(path: string, style: ImportStyle): string {
  if (style === 'js') return `${path}.js`
  if (style === 'ts') return `${path}.ts`
  return path
}

export function withClientImportStyle(
  path: string,
  style: ImportStyle,
  kind: PrismaClientKind,
): string {
  if (kind === 'package') return path
  if (!path.startsWith('.')) return path

  if (kind === 'prisma-client') {
    const entry = `${path}/client`
    return withImportStyle(entry, style)
  }

  if (style === 'js') return `${path}/index.js`
  return path
}