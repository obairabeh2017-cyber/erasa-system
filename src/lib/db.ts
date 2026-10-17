import { PrismaClient } from "@prisma/client";

// عميل Prisma واحد لكل عملية Node (يُعاد استخدامه أثناء التطوير مع إعادة التحميل).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
