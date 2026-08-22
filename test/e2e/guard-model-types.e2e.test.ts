// Type-level contract for the generated model extension.
//
// The generator emits one `GuardModelExtension` member per model. On a schema
// with many models that object rides inside Prisma's `ExtArgs` and is
// re-instantiated through every `<model><Op>Args<ExtArgs>` comparison, which can
// push a CONSUMING program past TypeScript's instantiation-depth limit — the
// error then surfaces in an unrelated file, so the consumer cannot attribute it.
//
// Any attempt to make that representation compact has to keep everything below
// working. These gates are the contract a compact form must not break.
//
// The `control` file is load-bearing, not a debugging leftover: an earlier
// version of this harness could not resolve the generated Prisma client and
// degraded every type to `any`, at which point all the positive gates passed
// vacuously and all the `@ts-expect-error` directives went unused. The control
// exercises the SAME client without prisma-guard in the path, so a resolution
// regression fails loudly instead of turning the suite green.
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  generatorPath,
  getPrismaMajor,
  moduleSearchPath,
  packageDirBeside,
  packageRoot,
  toolEntry,
  toolEnv,
  toolPackageDir,
} from "./toolchain";
import { run } from "./helpers";

/**
 * EVERY PATH HERE IS RESOLVED FROM THIS PACKAGE, NEVER FROM `process.cwd()`.
 *
 * This file used to read `<cwd>/node_modules` for the compiler, the Prisma CLI,
 * the client, the client runtime utilities and zod. That is one install layout —
 * this package on its own — and in the monorepo the five are split across two
 * `node_modules` trees, so all fourteen cases died with ENOENT before an
 * assertion ran. `test/e2e/toolchain.ts` resolves each one independently; see
 * its header for why a single `nodeModules` constant cannot be correct.
 */
const tscPath = toolEntry("typescript", "tsc");

// Models beyond the two the gates assert on. The point is breadth: the emitted
// extension object grows one member per model, and that growth is what the
// compact form has to remove.
function stressModels(count: number): string {
  return Array.from({ length: count }, (_, i) => {
    return `model Stress${i} {
  id    String @id @default(cuid())
  label String
}`;
  }).join("\n\n");
}

async function setupProject(stressCount: number) {
  const dir = await mkdtemp(join(tmpdir(), "prisma-guard-modeltypes-"));
  await mkdir(join(dir, "generated/guard"), { recursive: true });

  const prismaMajor = await getPrismaMajor();

  if (prismaMajor >= 7) {
    await writeFile(
      join(dir, "prisma.config.ts"),
      `import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "./schema.prisma",
  datasource: { url: "file:./dev.db" },
})
`,
      "utf-8",
    );
  }

  const datasource =
    prismaMajor >= 7
      ? `datasource db {\n  provider = "sqlite"\n}`
      : `datasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}`;

  const schema = `generator client {
  provider = "prisma-client"
  output   = "./generated/client"
}

generator guard {
  provider = "node ${generatorPath.replace(/\\/g, "\\\\")}"
  output   = "./generated/guard"
  onInvalidZod = "error"
  onAmbiguousScope = "warn"
  onMissingScopeContext = "error"
}

${datasource}

model User {
  id       String    @id @default(cuid())
  email    String
  projects Project[]
}

model Project {
  id     String @id @default(cuid())
  title  String
  userId String
  user   User   @relation(fields: [userId], references: [id])
}

${stressModels(stressCount)}
`;

  await writeFile(join(dir, "schema.prisma"), schema, "utf-8");

  const env = toolEnv();

  // Through `node` and the CLI's own entry, not a `.bin` shim: the shim exists
  // only in the layout that hoisted it, which is the assumption this file is
  // being cured of.
  const gen = await run("node", [toolEntry("prisma", "prisma"), "generate"], { cwd: dir, env });
  if (gen.code !== 0) {
    throw new Error(
      `prisma generate failed\n\nSTDOUT:\n${gen.stdout}\n\nSTDERR:\n${gen.stderr}`,
    );
  }

  return { dir, env };
}

// A declared factory rather than `new PrismaClient(...)`: this file is only ever
// typechecked, and Prisma 7's constructor requires a driver adapter that a type
// test has no reason to stand up. No cast is involved.
const GATES_SOURCE = `import { PrismaClient } from "./generated/client/client"
import { guard } from "./generated/guard/client"

declare function makeClient(): PrismaClient

const prisma = makeClient().$extends(guard.extension(() => ({})))

export async function gates() {
  // GATE 1 — user.guard(...).findMany() returns user payloads.
  const users = await prisma.user.guard({ select: { email: true, id: true } }).findMany()
  // GATE 7 — callback parameters infer concrete element types.
  const emails: string[] = users.map((u) => u.email)

  // GATE 2 — project.guard(...).findMany() returns project payloads.
  const projects = await prisma.project.guard({ select: { id: true, title: true } }).findMany()
  const titles: string[] = projects.map((p) => p.title)

  // GATE 3 — a user-only field fails on project.
  // @ts-expect-error \`email\` is not a Project field
  await prisma.project.guard({}).findMany({ select: { email: true } })

  // GATE 4 — a project-only field fails on user.
  // @ts-expect-error \`title\` is not a User field
  await prisma.user.guard({}).findMany({ select: { title: true } })

  // GATE 5 — resolve() remains typed.
  const resolved = prisma.user.guard({ select: { id: true } }).resolve({})
  const matched: string = resolved.matchedKey

  // GATE 6 — guard method arguments remain typed.
  // @ts-expect-error \`caller\` is a string
  prisma.user.guard({}, 42)

  return { emails, matched, titles }
}
`;

const CONTROL_SOURCE = `import { PrismaClient } from "./generated/client/client"
import { guard } from "./generated/guard/client"

declare function makeClient(): PrismaClient

const prisma = makeClient().$extends(guard.extension(() => ({})))

// HARNESS VALIDITY. Same client, same extension, no .guard() in the path. If the
// generated client stops resolving, these fail first and the gates above cannot
// pass vacuously.
export async function control() {
  const users = await prisma.user.findMany()
  const emails: string[] = users.map((u) => u.email)

  // @ts-expect-error \`title\` is not a User field
  await prisma.user.findMany({ select: { title: true } })

  return emails
}
`;

/**
 * Bundler resolution does not walk out of a tmp dir to find these, so every
 * package the generated client pulls in is mapped explicitly — each one to where
 * it REALLY is, which in a workspace is not one shared directory.
 *
 * `@prisma/client-runtime-utils` is anchored to the client rather than searched:
 * this repo holds two copies at different versions, and pairing the client's
 * types with the other one degrades the generated types the `control` gate below
 * exists to protect.
 */
const clientDir = toolPackageDir("@prisma/client");
const runtimeUtilsDir = packageDirBeside("@prisma/client", "@prisma/client-runtime-utils");
const zodDir = toolPackageDir("zod");

function tsconfigFor(files: string[]) {
  return {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
      baseUrl: ".",
      paths: {
        "@prisma/client": [clientDir],
        "@prisma/client/*": [join(clientDir, "*")],
        ...(runtimeUtilsDir === null
          ? {}
          : { "@prisma/client-runtime-utils": [runtimeUtilsDir] }),
        "prisma-guard": [join(packageRoot, "dist/runtime/index.d.ts")],
        zod: [zodDir],
      },
    },
    include: files,
  };
}

async function typecheck(dir: string, env: NodeJS.ProcessEnv, files: string[]) {
  const tsconfigPath = join(dir, "tsconfig.types.json");
  await writeFile(
    tsconfigPath,
    JSON.stringify(tsconfigFor(files), null, 2),
    "utf-8",
  );

  return run("node", [tscPath, "-p", tsconfigPath, "--noEmit"], { cwd: dir, env });
}

/**
 * THE HARNESS'S OWN CONTROL, and it runs before the fixtures.
 *
 * The gates below are only meaningful if the compiler, the CLI, the client and
 * zod were all really found. When they are not, `tsc` maps nothing, every type
 * degrades to `any`, the positive gates pass vacuously and the
 * `@ts-expect-error` directives go unused — the failure mode this file's
 * `control.ts` fixture already guards at the type level. These assert the same
 * thing one layer earlier, at resolution, where the workspace layout breaks it.
 */
describe("the harness resolves its toolchain, in whatever layout it is installed", () => {
  it("finds every package it maps into the generated project's tsconfig", () => {
    for (const [label, dir] of [
      ["@prisma/client", clientDir],
      ["zod", zodDir],
      ["typescript (tsc)", tscPath],
      ["prisma-guard runtime", join(packageRoot, "dist/runtime/index.d.ts")],
    ] as const) {
      expect(existsSync(dir), `${label} is not at ${dir}`).toBe(true);
    }
    // Prisma 7's client alone depends on `@prisma/client-runtime-utils`. The v6
    // client ships no such package, so under that major there is nothing to find
    // and nothing mapped into the tsconfig.
    if (getPrismaMajor() >= 7) {
      expect(runtimeUtilsDir, "@prisma/client-runtime-utils was not found").not.toBeNull();
    }
  });

  it.skipIf(getPrismaMajor() < 7)("pairs the client with ITS OWN runtime utilities, not another copy's", () => {
    // This repo really holds two, at different versions. Mapping the client's
    // types against the other one is a resolution regression that degrades the
    // generated types rather than failing loudly.
    const version = (dir: string) =>
      (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { version: string }).version;

    expect(version(runtimeUtilsDir!)).toBe(version(clientDir));
  });

  it("does not assume one node_modules holds them all", () => {
    /**
     * The defect this file was cured of. Installed standalone the tools and the
     * client share a directory; installed in this workspace they do not, because
     * the root pins a conflicting Prisma major. A harness that names ONE
     * directory is right in the first layout and finds nothing in the second, so
     * what is asserted is that each package is reached through the search path
     * rather than through a single assumed root.
     */
    const search = moduleSearchPath();
    const holder = (dir: string) => search.find((base) => dir.startsWith(base + sep));

    expect(holder(clientDir), `${clientDir} is outside the search path`).toBeDefined();
    expect(holder(tscPath), `${tscPath} is outside the search path`).toBeDefined();
    expect(search.every((dir) => dir.endsWith("node_modules"))).toBe(true);
  });
});

describe("e2e: generated guard model types", () => {
  it(
    "keeps model-specific guarded delegate types, and the control proves the harness can fail",
    async () => {
      const { dir, env } = await setupProject(0);

      await writeFile(join(dir, "gates.ts"), GATES_SOURCE, "utf-8");
      await writeFile(join(dir, "control.ts"), CONTROL_SOURCE, "utf-8");

      const tc = await typecheck(dir, env, ["gates.ts", "control.ts"]);
      if (tc.code !== 0) {
        throw new Error(
          `tsc failed\n\nSTDOUT:\n${tc.stdout}\n\nSTDERR:\n${tc.stderr}`,
        );
      }

      // The harness must be able to report a failure. Without this, a resolution
      // regression that turns every type into `any` reads as a clean pass.
      await writeFile(
        join(dir, "control.ts"),
        CONTROL_SOURCE.replace(
          "const emails: string[] = users.map((u) => u.email)",
          "const emails: number[] = users.map((u) => u.email)",
        ),
        "utf-8",
      );

      const negative = await typecheck(dir, env, ["control.ts"]);
      expect(negative.code).not.toBe(0);
      // `string[]` specifically: proves the payload type is real rather than `any`.
      expect(negative.stdout).toContain(
        "Type 'string[]' is not assignable to type 'number[]'",
      );
    },
    120000,
  );

  it(
    "emits one compact model extension entry rather than one member per model",
    async () => {
      const { dir } = await setupProject(0);

      const client = await readFile(
        join(dir, "generated/guard/client.ts"),
        "utf-8",
      );

      // The contract this fixture exists to drive. Fails against the per-model
      // emission. Breadth matters because the emitted object rides inside
      // Prisma's ExtArgs: a consumer with many models re-instantiates it through
      // every args comparison, and a large enough consumer hits TypeScript's
      // instantiation-depth limit — reported in an unrelated file, so it reads
      // as an unrelated defect.
      expect(client).toContain("$allModels");
      expect(client).not.toMatch(/^\s+user: \{$/m);
      expect(client).not.toMatch(/^\s+project: \{$/m);
    },
    120000,
  );

  it(
    "typechecks a large-model schema",
    async () => {
      const { dir, env } = await setupProject(80);

      await writeFile(join(dir, "gates.ts"), GATES_SOURCE, "utf-8");
      await writeFile(join(dir, "control.ts"), CONTROL_SOURCE, "utf-8");

      const tc = await typecheck(dir, env, ["gates.ts", "control.ts"]);
      if (tc.code !== 0) {
        throw new Error(
          `tsc failed on an 82-model schema\n\nSTDOUT:\n${tc.stdout}\n\nSTDERR:\n${tc.stderr}`,
        );
      }
    },
    180000,
  );
});
