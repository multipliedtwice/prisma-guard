import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * THE TOOLCHAIN IS RESOLVED, NOT GUESSED AT A PATH.
 *
 * Both e2e suites used to compute `process.cwd()` and then read
 * `<cwd>/node_modules/prisma`, `<cwd>/node_modules/.bin`,
 * `<cwd>/node_modules/typescript` and `<cwd>/node_modules/@prisma/client`. That
 * describes ONE install layout — this package installed on its own — and it is
 * not the layout the package is developed in. Inside the monorepo the installer
 * hoists: `prisma` and `typescript` land in the ROOT `node_modules` while
 * `@prisma/client` and `zod` stay in this package's own, because the root pins a
 * conflicting major. Every hardcoded path is then absent, and the cases die with
 * ENOENT before a single assertion runs.
 *
 * `prisma`, `typescript`, `@prisma/client` and `zod` are all DECLARED
 * dependencies of this package, so Node's own resolution finds each of them from
 * THIS FILE wherever the installer put it — and, crucially, finds them
 * INDEPENDENTLY. A single `nodeModules` constant cannot be right when the four
 * live in two different directories, which is the specific way the old shape
 * failed in a workspace.
 *
 * Nothing here depends on the directory the runner was started from.
 */

const requireFromHere = createRequire(import.meta.url)

/** This package, rather than whatever directory the runner was started in. */
export const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

/** The generator entry this package builds, addressed from the package itself. */
export const generatorPath = resolve(packageRoot, 'dist/generator/index.js')

/** The directory a resolvable package really occupies. */
export function toolPackageDir(name: string): string {
  return dirname(requireFromHere.resolve(`${name}/package.json`))
}

/**
 * A package whose `exports` map does not publish `./package.json`, found BESIDE
 * the one it has to agree with.
 *
 * `@prisma/client-runtime-utils` is such a package: Node refuses the subpath
 * with `ERR_PACKAGE_PATH_NOT_EXPORTED`, so resolution cannot answer where it
 * lives and it has to be probed on disk.
 *
 * ANCHORED, and that is the whole of it. This repo really does hold two copies —
 * 7.5.0 hoisted to the root beside the root's Prisma, and 7.9.0 in this
 * package's own tree beside the client this package uses. Probing a search path
 * in order finds the root's, pairs 7.9.0 client types with 7.5.0 runtime types,
 * and produces exactly the kind of resolution failure the `control` gate in
 * `guard-model-types.e2e.test.ts` exists to catch. So the anchor's own
 * `node_modules` is searched first.
 */
export function packageDirBeside(anchorName: string, name: string): string | null {
  const bases = [containingNodeModules(toolPackageDir(anchorName)), ...moduleSearchPath()]
  for (const dir of [...new Set(bases)]) {
    const candidate = join(dir, ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return null
}

/**
 * A tool's own entry point, read from its `bin` field.
 *
 * Run through `node` rather than through a `.bin` shim: the shim is an artefact
 * of one install layout, and the field is the package's own declaration of what
 * to execute.
 */
export function toolEntry(name: string, binName: string): string {
  const dir = toolPackageDir(name)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
    bin?: string | Record<string, string>
  }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName]
  if (!bin) throw new Error(`${name} declares no "${binName}" binary`)
  return resolve(dir, bin)
}

/**
 * Every `node_modules` the resolved packages actually live in, deduplicated.
 *
 * More than one, and that is the point: in a workspace the tools and the client
 * are in different trees, and a child process needs both on its search path.
 */
export function moduleSearchPath(): string[] {
  const dirs = ['prisma', 'typescript', '@prisma/client', 'zod'].flatMap((name) => {
    try {
      return [containingNodeModules(toolPackageDir(name))]
    } catch {
      return []
    }
  })
  return [...new Set(dirs)]
}

/**
 * The `node_modules` a resolved package sits in.
 *
 * Walked rather than sliced: a scoped package is TWO levels down
 * (`node_modules/@prisma/client`) and an unscoped one is one, so trimming a
 * fixed number of segments is right for one shape and silently wrong for the
 * other — which is how `@prisma` itself ended up on a module search path.
 */
function containingNodeModules(packageDir: string): string {
  let dir = dirname(packageDir)
  while (dir !== dirname(dir)) {
    if (dir.endsWith(`${sep}node_modules`) || dir.endsWith('/node_modules')) return dir
    dir = dirname(dir)
  }
  throw new Error(`${packageDir} is not inside a node_modules directory`)
}

/** What a child process needs to find the same toolchain this test resolved. */
export function toolEnv(): NodeJS.ProcessEnv {
  const search = moduleSearchPath()
  const binDirs = search.map((dir) => join(dir, '.bin'))
  return {
    ...process.env,
    PATH: [...binDirs, process.env.PATH].filter(Boolean).join(delimiter),
    NODE_PATH: search.join(delimiter),
    DATABASE_URL: 'file:./dev.db',
  }
}

let prismaMajorCache: number | undefined

export function getPrismaMajor(): number {
  if (prismaMajorCache !== undefined) return prismaMajorCache
  const manifest = JSON.parse(
    readFileSync(join(toolPackageDir('prisma'), 'package.json'), 'utf-8'),
  ) as { version: string }
  prismaMajorCache = Number(manifest.version.split('.')[0])
  return prismaMajorCache
}
