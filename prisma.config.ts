import "dotenv/config";
import type { PrismaConfig } from "prisma";

export default {
  schema: "test/e2e/fixtures/schema.prisma",
  datasource: {
    url: "file:./dev.db",
  },
} satisfies PrismaConfig;
