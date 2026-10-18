import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrls } from "./db-env.mjs";

// عميل Prisma واحد لكل عملية Node (يُعاد استخدامه أثناء التطوير مع إعادة التحميل).
// الرابط يُقرأ من أي اسم متغير تضعه Vercel/Neon (DATABASE_URL أو POSTGRES_URL أو ببادئة مخصصة).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const urls = resolveDatabaseUrls();
  return urls ? new PrismaClient({ datasourceUrl: urls.pooled.value }) : new PrismaClient();
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
