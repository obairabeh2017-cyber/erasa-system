import { PrismaClient } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { resolveDatabaseUrls } from "./db-env.mjs";

// عميل Prisma واحد لكل عملية Node، يُنشأ عند أول استعلام فقط (لا عند تحميل الكود أثناء البناء).
// - إن وُجد رابط PostgreSQL (مثل Neon) يُستخدم.
// - وإلا تُستخدم قاعدة البيانات المدمجة (PGlite) داخل نفس العملية: يفتحها server.mjs
//   ويطبّق ترحيلاتها، ويضعها في globalThis.__erasaPglite.
const g = globalThis as unknown as { prisma?: PrismaClient; __erasaPglite?: PGlite };

function createClient(): PrismaClient {
  const urls = resolveDatabaseUrls();
  if (urls) return new PrismaClient({ datasourceUrl: urls.pooled.value });
  const pg = (g.__erasaPglite ??= new PGlite(process.env.LOCAL_DB_DIR || "./data/pglite"));
  return new PrismaClient({ adapter: new PrismaPGlite(pg) });
}

function client(): PrismaClient {
  return (g.prisma ??= createClient());
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});

export type Db = PrismaClient;
