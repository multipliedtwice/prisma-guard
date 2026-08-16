import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./helpers";

async function readText(path: string) {
  return readFile(path, "utf-8");
}

async function pathExists(p: string) {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * THE TOOLCHAIN IS RESOLVED, NOT GUESSED AT A PATH.
 *
 * This computed `process.cwd()` and then read `<cwd>/node_modules/prisma`,
 * `<cwd>/node_modules/.bin` and `<cwd>/node_modules/typescript`. That describes
 * one install layout — a package installed on its own — and it is not the layout
 * this package is developed in: inside a workspace the installer hoists
 * dependencies to the root, so every one of those paths is absent and all
 * fourteen cases here died with ENOENT before a single assertion ran.
 *
 * `prisma` and `typescript` are DECLARED dependencies of this package, so Node's
 * own resolution can find them from this file wherever they were placed, and the
 * directory holding them is where the executables and the module search path
 * come from. Nothing here depends on being run from any particular directory.
 */
const requireFromHere = createRequire(import.meta.url);

/** This package, rather than whatever directory the runner was started in. */
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const generatorPath = resolve(packageRoot, "dist/generator/index.js");

function toolPackageDir(name: string): string {
  return dirname(requireFromHere.resolve(`${name}/package.json`));
}

/**
 * A tool's own entry point, read from its `bin` field.
 *
 * Run through `node` rather than through a `.bin` shim: the shim is an artefact
 * of one install layout, and the field is the package's own declaration of what
 * to execute.
 */
async function toolEntry(name: string, binName: string): Promise<string> {
  const dir = toolPackageDir(name);
  const manifest = JSON.parse(await readText(join(dir, "package.json"))) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (!bin) throw new Error(`${name} declares no "${binName}" binary`);
  return resolve(dir, bin);
}

/** Every `node_modules` the resolved tools actually live in, deduplicated. */
function moduleSearchPath(): string[] {
  const dirs = ["prisma", "typescript"].map((name) => dirname(toolPackageDir(name)));
  return [...new Set(dirs)];
}

/** What a child process needs to find the same toolchain this test resolved. */
function toolEnv(): NodeJS.ProcessEnv {
  const search = moduleSearchPath();
  const binDirs = search.map((dir) => join(dir, ".bin"));
  return {
    ...process.env,
    PATH: [...binDirs, process.env.PATH].filter(Boolean).join(delimiter),
    NODE_PATH: search.join(delimiter),
    DATABASE_URL: "file:./dev.db",
  };
}

let prismaMajorCache: number | undefined;

async function getPrismaMajor() {
  if (prismaMajorCache !== undefined) return prismaMajorCache;
  const prismaPkg = JSON.parse(
    await readText(join(toolPackageDir("prisma"), "package.json")),
  ) as { version: string };
  prismaMajorCache = Number(prismaPkg.version.split(".")[0]);
  return prismaMajorCache;
}

function generatorBlock(overrides: Record<string, string> = {}) {
  const opts: Record<string, string> = {
    provider: `"node ${generatorPath.replace(/\\/g, "\\\\")}"`,
    output: '"./generated/guard"',
    onInvalidZod: '"error"',
    onAmbiguousScope: '"warn"',
    onMissingScopeContext: '"error"',
    ...overrides,
  };
  const lines = Object.entries(opts).map(([k, v]) => `  ${k} = ${v}`);
  return `generator guard {\n${lines.join("\n")}\n}`;
}

function datasourceBlock(prismaMajor: number) {
  if (prismaMajor >= 7) {
    return `datasource db {\n  provider = "sqlite"\n}`;
  }
  return `datasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}`;
}

async function setupTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "prisma-guard-e2e-"));
  await mkdir(join(dir, "generated/guard"), { recursive: true });

  const prismaMajor = await getPrismaMajor();

  if (prismaMajor >= 7) {
    const prismaConfig = `import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./schema.prisma",
  datasource: {
    url: "file:./dev.db",
  },
});
`;
    await writeFile(join(dir, "prisma.config.ts"), prismaConfig, "utf-8");
  }

  return dir;
}

async function runGenerate(dir: string, schema: string) {
  const schemaPath = join(dir, "schema.prisma");
  await writeFile(schemaPath, schema, "utf-8");

  return run(process.execPath, [await toolEntry("prisma", "prisma"), "generate", "--schema", schemaPath], {
    cwd: dir,
    env: toolEnv(),
  });
}

async function makeSchema(body: string, overrides: Record<string, string> = {}) {
  const prismaMajor = await getPrismaMajor();
  return `
${generatorBlock(overrides)}

${datasourceBlock(prismaMajor)}

${body.trim()}
`.trim();
}

describe("e2e: prisma-guard generator", () => {
  it(
    "emits scope/type/enum/zod outputs via prisma generate and TS typechecks",
    async () => {
      const dir = await setupTempDir();
      const env = toolEnv();

      const schema = await makeSchema(`
enum Role {
  USER
  ADMIN
}

/// @scope-root
model Tenant {
  id   String @id @default(cuid())
  name String

  projects       Project[]
  projectMembers ProjectMember[]
  ambiguousA     AmbiguousLink[] @relation("A")
  ambiguousB     AmbiguousLink[] @relation("B")
}

model Project {
  id        String @id @default(cuid())
  tenantId  String
  tenant    Tenant @relation(fields: [tenantId], references: [id])

  /// @zod .min(1)
  title     String

  role      Role @default(USER)

  members   ProjectMember[]
}

model ProjectMember {
  id         String @id @default(cuid())
  tenantId   String
  tenant     Tenant @relation(fields: [tenantId], references: [id])
  projectId  String
  project    Project @relation(fields: [projectId], references: [id])

  /// @zod .email()
  email      String
}

model AmbiguousLink {
  id        String @id @default(cuid())
  tenantAId String
  tenantBId String
  tenantA   Tenant @relation("A", fields: [tenantAId], references: [id])
  tenantB   Tenant @relation("B", fields: [tenantBId], references: [id])
}
`);

      const gen = await runGenerate(dir, schema);
      if (gen.code !== 0) {
        throw new Error(
          `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
        );
      }

      const outPath = join(dir, "generated/guard/index.ts");
      expect(await pathExists(outPath)).toBe(true);

      const out = await readText(outPath);

      expect(out).toContain("export const GUARD_CONFIG =");
      expect(out).toContain("export const SCOPE_MAP =");
      expect(out).toContain("export const TYPE_MAP =");
      expect(out).toContain("export const ENUM_MAP =");
      expect(out).toContain("export const ZOD_CHAINS =");

      expect(out).toContain(
        'Project: [{ fk: "tenantId", root: "Tenant", relationName: "tenant" }]',
      );
      expect(out).toContain(
        'ProjectMember: [{ fk: "tenantId", root: "Tenant", relationName: "tenant" }]',
      );
      expect(out).not.toContain("AmbiguousLink:");

      expect(out).toMatch(/export type ScopeRoot = .*'Tenant'.*/);

      expect(out).toContain('"Role": ["USER", "ADMIN"]');
      expect(out).toContain('"title": (base: any) => base.min(1)');
      expect(out).toContain('"email": (base: any) => base.email()');

      const tsconfig = {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
          types: [],
        },
        include: [outPath],
      };

      const tsconfigPath = join(dir, "tsconfig.e2e.json");
      await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf-8");

      const tscPath = await toolEntry("typescript", "tsc");
      const tc = await run(process.execPath, [tscPath, "-p", tsconfigPath, "--noEmit"], {
        cwd: dir,
        env,
      });

      if (tc.code !== 0) {
        throw new Error(
          `tsc failed\n\nSTDOUT:\n${tc.stdout}\n\nSTDERR:\n${tc.stderr}`,
        );
      }
    },
    30000,
  );

  it("emits GUARD_CONFIG with onMissingScopeContext from generator config", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(
      `
model Tenant {
  id   String @id @default(cuid())
  name String

  /// @scope-root
}
`,
      { onMissingScopeContext: '"warn"' },
    );

    const gen = await runGenerate(dir, schema);
    if (gen.code !== 0) {
      throw new Error(
        `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
      );
    }

    const out = await readText(join(dir, "generated/guard/index.ts"));
    expect(out).toContain('onMissingScopeContext: "warn"');
  });

  it("fails on ambiguous scope when onAmbiguousScope is error", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(
      `
/// @scope-root
model Tenant {
  id   String @id @default(cuid())
  name String

  ambiguousA AmbiguousLink[] @relation("A")
  ambiguousB AmbiguousLink[] @relation("B")
}

model AmbiguousLink {
  id        String @id @default(cuid())
  tenantAId String
  tenantBId String
  tenantA   Tenant @relation("A", fields: [tenantAId], references: [id])
  tenantB   Tenant @relation("B", fields: [tenantBId], references: [id])
}
`,
      { onAmbiguousScope: '"error"' },
    );

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Ambiguous scope");
  });

  it("fails on invalid @zod directive when onInvalidZod is error", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
model Item {
  id    String @id @default(cuid())
  /// @zod .unknownMethod()
  name  String
}
`);

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Unknown zod method");
  });

  it("fails on empty @zod directive when onInvalidZod is error", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
model Item {
  id    String @id @default(cuid())
  /// @zod
  name  String
}
`);

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Empty @zod directive");
  });

  it("fails on multiple @zod directives on same field", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
model Item {
  id    String @id @default(cuid())
  /// @zod .min(1)
  /// @zod .max(100)
  name  String
}
`);

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Multiple @zod directives");
  });

  it("fails on invalid generator config value", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(
      `
model Item {
  id   String @id @default(cuid())
  name String
}
`,
      { onInvalidZod: '"crash"' },
    );

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Invalid generator config");
  });

  it("emits empty ZOD_CHAINS when no @zod directives present", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
model Item {
  id   String @id @default(cuid())
  name String
}
`);

    const gen = await runGenerate(dir, schema);
    if (gen.code !== 0) {
      throw new Error(
        `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
      );
    }

    const out = await readText(join(dir, "generated/guard/index.ts"));
    expect(out).toContain("export const ZOD_CHAINS = {}");
  });

  it("emits ScopeRoot as never when no @scope-root models exist", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
model Item {
  id   String @id @default(cuid())
  name String
}
`);

    const gen = await runGenerate(dir, schema);
    if (gen.code !== 0) {
      throw new Error(
        `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
      );
    }

    const out = await readText(join(dir, "generated/guard/index.ts"));
    expect(out).toContain("export type ScopeRoot = never");
    expect(out).toMatch(/export const SCOPE_MAP = \{\s*\} as const/);
  });

  it("emits correct type map field metadata", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
enum Status {
  ACTIVE
  INACTIVE
}

model Record {
  id        String   @id @default(cuid())
  title     String
  count     Int
  score     Float?
  active    Boolean  @default(true)
  status    Status   @default(ACTIVE)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`);

    const gen = await runGenerate(dir, schema);
    if (gen.code !== 0) {
      throw new Error(
        `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
      );
    }

    const out = await readText(join(dir, "generated/guard/index.ts"));

    expect(out).toContain(
      '"id": { type: "String", isList: false, isRequired: true, isId: true',
    );
    expect(out).toContain(
      '"title": { type: "String", isList: false, isRequired: true, isId: false',
    );
    expect(out).toContain('"count": { type: "Int"');
    expect(out).toContain(
      '"score": { type: "Float", isList: false, isRequired: false',
    );
    expect(out).toContain('"active": { type: "Boolean"');
    expect(out).toContain('"status": { type: "Status"');
    expect(out).toContain("isEnum: true");
    expect(out).toContain('"updatedAt": { type: "DateTime"');
    expect(out).toContain("isUpdatedAt: true");
    expect(out).toContain('"Status": ["ACTIVE", "INACTIVE"]');
  });

  it("handles chained @zod directives", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
model User {
  id    String @id @default(cuid())
  /// @zod .email().max(255)
  email String
  /// @zod .min(1).max(100).trim()
  name  String
  /// @zod .int().positive()
  age   Int
}
`);

    const gen = await runGenerate(dir, schema);
    if (gen.code !== 0) {
      throw new Error(
        `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
      );
    }

    const out = await readText(join(dir, "generated/guard/index.ts"));
    expect(out).toContain('"email": (base: any) => base.email().max(255)');
    expect(out).toContain('"name": (base: any) => base.min(1).max(100).trim()');
    expect(out).toContain('"age": (base: any) => base.int().positive()');
  });

  it("emits multiple scope roots and maps models to correct roots", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
/// @scope-root
model Company {
  id   String @id @default(cuid())
  name String

  projects Project[]
}

/// @scope-root
model User {
  id   String @id @default(cuid())
  name String

  tasks Task[]
}

model Project {
  id        String @id @default(cuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id])
  title     String
}

model Task {
  id     String @id @default(cuid())
  userId String
  user   User @relation(fields: [userId], references: [id])
  title  String
}
`);

    const gen = await runGenerate(dir, schema);
    if (gen.code !== 0) {
      throw new Error(
        `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
      );
    }

    const out = await readText(join(dir, "generated/guard/index.ts"));
    expect(out).toContain(
      'Project: [{ fk: "companyId", root: "Company", relationName: "company" }]',
    );
    expect(out).toContain(
      'Task: [{ fk: "userId", root: "User", relationName: "user" }]',
    );
    expect(out).toMatch(/export type ScopeRoot = .*'Company'/);
    expect(out).toMatch(/export type ScopeRoot = .*'User'/);
  });

  it("succeeds with onAmbiguousScope ignore + onInvalidZod warn, excludes ambiguous model and invalid chain", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(
      `
/// @scope-root
model Tenant {
  id     String @id @default(cuid())
  name   String
  linksA AmbiguousLink[] @relation("A")
  linksB AmbiguousLink[] @relation("B")
  cleans Clean[]
}

model AmbiguousLink {
  id        String @id @default(cuid())
  tenantAId String
  tenantBId String
  tenantA   Tenant @relation("A", fields: [tenantAId], references: [id])
  tenantB   Tenant @relation("B", fields: [tenantBId], references: [id])
}

model Clean {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  /// @zod .unknownMethod()
  bad      String
  /// @zod .min(1)
  good     String
}
`,
      { onAmbiguousScope: '"ignore"', onInvalidZod: '"warn"' },
    );

    const gen = await runGenerate(dir, schema);
    if (gen.code !== 0) {
      throw new Error(
        `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
      );
    }

    const out = await readText(join(dir, "generated/guard/index.ts"));
    expect(out).not.toContain("AmbiguousLink:");
    expect(out).toContain(
      'Clean: [{ fk: "tenantId", root: "Tenant", relationName: "tenant" }]',
    );
    expect(out).toContain('"good": (base: any) => base.min(1)');
    expect(out).not.toContain('"bad": (base: any)');
  });

  it("excludes indirect FK chains from scope map", async () => {
    const dir = await setupTempDir();

    const schema = await makeSchema(`
/// @scope-root
model Org {
  id    String @id @default(cuid())
  name  String
  teams Team[]
}

model Team {
  id    String @id @default(cuid())
  orgId String
  org   Org @relation(fields: [orgId], references: [id])
  tasks Task[]
}

model Task {
  id     String @id @default(cuid())
  teamId String
  team   Team @relation(fields: [teamId], references: [id])
  title  String
}
`);

    const gen = await runGenerate(dir, schema);
    if (gen.code !== 0) {
      throw new Error(
        `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
      );
    }

    const out = await readText(join(dir, "generated/guard/index.ts"));
    expect(out).toContain(
      'Team: [{ fk: "orgId", root: "Org", relationName: "org" }]',
    );
    expect(out).not.toContain("Task:");
  });
});