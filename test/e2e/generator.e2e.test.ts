import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

const repoRoot = resolve(process.cwd());
const generatorPath = resolve(repoRoot, "dist/generator/index.js");
const prismaBin =
  process.platform === "win32"
    ? join(repoRoot, "node_modules", ".bin", "prisma.cmd")
    : join(repoRoot, "node_modules", ".bin", "prisma");

async function setupTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "prisma-guard-e2e-"));
  await mkdir(join(dir, "generated/guard"), { recursive: true });

  const prismaConfig = `import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./schema.prisma",
  datasource: {
    url: "file:./dev.db",
  },
});
`;
  await writeFile(join(dir, "prisma.config.ts"), prismaConfig, "utf-8");

  return dir;
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

const DATASOURCE_BLOCK = `datasource db {\n  provider = "sqlite"\n}`;

async function runGenerate(dir: string, schema: string) {
  const schemaPath = join(dir, "schema.prisma");
  await writeFile(schemaPath, schema, "utf-8");

  const binDir = join(repoRoot, "node_modules", ".bin");
  const pathSep = process.platform === "win32" ? ";" : ":";

  const env = {
    PATH: `${binDir}${pathSep}${process.env.PATH}`,
    NODE_PATH: join(repoRoot, "node_modules"),
  };

  return run(prismaBin, ["generate", "--schema", schemaPath], {
    cwd: dir,
    env,
  });
}

describe("e2e: prisma-guard generator", () => {
  it(
    "emits scope/type/enum/zod outputs via prisma generate and TS typechecks",
    async () => {
      const dir = await setupTempDir();
      const binDir = join(repoRoot, "node_modules", ".bin");
      const pathSep = process.platform === "win32" ? ";" : ":";
      const env = {
        PATH: `${binDir}${pathSep}${process.env.PATH}`,
        NODE_PATH: join(repoRoot, "node_modules"),
      };

      const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

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
`.trim();

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

      const tscPath = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
      const tc = await run("node", [tscPath, "-p", tsconfigPath, "--noEmit"], {
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

    const schema = `
${generatorBlock({ onMissingScopeContext: '"warn"' })}

${DATASOURCE_BLOCK}

model Tenant {
  id   String @id @default(cuid())
  name String

  /// @scope-root
}
`.trim();

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

    const schema = `
${generatorBlock({ onAmbiguousScope: '"error"' })}

${DATASOURCE_BLOCK}

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
`.trim();

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Ambiguous scope");
  });

  it("fails on invalid @zod directive when onInvalidZod is error", async () => {
    const dir = await setupTempDir();

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

model Item {
  id    String @id @default(cuid())
  /// @zod .unknownMethod()
  name  String
}
`.trim();

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Unknown zod method");
  });

  it("fails on empty @zod directive when onInvalidZod is error", async () => {
    const dir = await setupTempDir();

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

model Item {
  id    String @id @default(cuid())
  /// @zod
  name  String
}
`.trim();

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Empty @zod directive");
  });

  it("fails on multiple @zod directives on same field", async () => {
    const dir = await setupTempDir();

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

model Item {
  id    String @id @default(cuid())
  /// @zod .min(1)
  /// @zod .max(100)
  name  String
}
`.trim();

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Multiple @zod directives");
  });

  it("fails on invalid generator config value", async () => {
    const dir = await setupTempDir();

    const schema = `
${generatorBlock({ onInvalidZod: '"crash"' })}

${DATASOURCE_BLOCK}

model Item {
  id   String @id @default(cuid())
  name String
}
`.trim();

    const gen = await runGenerate(dir, schema);
    expect(gen.code).not.toBe(0);
    expect(gen.stderr).toContain("Invalid generator config");
  });

  it("emits empty ZOD_CHAINS when no @zod directives present", async () => {
    const dir = await setupTempDir();

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

model Item {
  id   String @id @default(cuid())
  name String
}
`.trim();

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

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

model Item {
  id   String @id @default(cuid())
  name String
}
`.trim();

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

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

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
`.trim();

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

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

model User {
  id    String @id @default(cuid())
  /// @zod .email().max(255)
  email String
  /// @zod .min(1).max(100).trim()
  name  String
  /// @zod .int().positive()
  age   Int
}
`.trim();

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

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

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
`.trim();

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

    const schema = `
${generatorBlock({ onAmbiguousScope: '"ignore"', onInvalidZod: '"warn"' })}

${DATASOURCE_BLOCK}

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
`.trim();

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

    const schema = `
${generatorBlock()}

${DATASOURCE_BLOCK}

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
`.trim();

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