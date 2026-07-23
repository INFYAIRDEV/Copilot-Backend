import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // Enable logs to help diagnose connectivity issues (no secrets logged)
    log: ["error", "warn", "info"],
  }); // SSL and other options are taken from DATABASE_URL

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
