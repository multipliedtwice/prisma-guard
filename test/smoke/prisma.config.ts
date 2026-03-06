import type { PrismaConfig } from "prisma";

export default {
  schema: "./schema.prisma",
  datasource: {
    url: "file:./dev.db",
  },
} satisfies PrismaConfig;