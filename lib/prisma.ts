import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";

function getSqliteUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("file:/")) {
    return process.env.DATABASE_URL;
  }
  const prismaDb = path.join(process.cwd(), "prisma", "dev.db");
  const rootDb = path.join(process.cwd(), "dev.db");
  const chosen = fs.existsSync(prismaDb) ? prismaDb : rootDb;
  return `file:${chosen.replace(/\\/g, "/")}`;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: getSqliteUrl()
      }
    },
    log: ["error"]
  });

globalForPrisma.prisma = prisma;

