import { PrismaClient } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import fs from "node:fs";
import path from "node:path";
import { ensureDefaults } from "@/lib/services/setup";

// قاعدة PostgreSQL حقيقية داخل الذاكرة (PGlite) لكل اختبار، مُنشأة من ملفات الترحيل الفعلية
// نفسها التي تُطبّق على Neon — دون الحاجة لخادم خارجي.
const migrationsDir = path.resolve(process.cwd(), "prisma", "migrations");
const migrationSql = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((d) => fs.readFileSync(path.join(migrationsDir, d, "migration.sql"), "utf8"))
  .join("\n");

const open: { db: PrismaClient; pg: PGlite }[] = [];

export async function emptyDb(): Promise<PrismaClient> {
  const pg = new PGlite();
  await pg.exec(migrationSql);
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  open.push({ db, pg });
  return db;
}

/** قاعدة جديدة معزولة مع القوائم الافتراضية. */
export async function freshDb(): Promise<PrismaClient> {
  const db = await emptyDb();
  await ensureDefaults(db);
  return db;
}

export async function closeAll() {
  for (const { db, pg } of open.splice(0)) {
    await db.$disconnect();
    await pg.close();
  }
}

export const Q = (n: number) => Math.round(n * 1000); // كمية
export const M = (n: number) => Math.round(n * 1000); // مبلغ (دينار → درهم)

export async function unitId(db: PrismaClient, name = "متر") {
  return (await db.unit.findUniqueOrThrow({ where: { name } })).id;
}

export async function makeItem(
  db: PrismaClient,
  data: { sku: string; name: string; type: "RAW" | "FINISHED"; unit?: string; minStock?: number; salePrice?: number },
) {
  return db.item.create({
    data: {
      sku: data.sku,
      name: data.name,
      type: data.type,
      unitId: await unitId(db, data.unit ?? (data.type === "RAW" ? "متر" : "قطعة")),
      minStock: data.minStock ?? 0,
      salePrice: data.salePrice ?? 0,
    },
  });
}

export async function cashAccountId(db: PrismaClient) {
  return (await db.cashAccount.findFirstOrThrow()).id;
}
