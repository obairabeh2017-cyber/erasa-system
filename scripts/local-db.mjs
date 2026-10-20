// قاعدة بيانات PostgreSQL مدمجة داخل البرنامج (PGlite) للتشغيل على جهاز الشركة.
// البيانات تُحفظ في المجلد data/pglite، ولا تحتاج تثبيت أي برنامج قاعدة بيانات.
// تعمل داخل نفس عملية البرنامج (بدون منفذ شبكة)، فلا يصل إليها أحد من الخارج.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const LOCAL_DB_DIR = process.env.LOCAL_DB_DIR || "./data/pglite";
const MIGRATIONS_DIR = path.resolve("prisma", "migrations");

/**
 * يطبّق ملفات الترحيل الناقصة مباشرة على القاعدة المدمجة، ويسجّلها في جدول _prisma_migrations
 * بنفس صيغة Prisma. كل ترحيل داخل معاملة مستقلة.
 */
export async function applyMigrations(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  const done = new Set(
    (await db.query(`SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`)).rows.map(
      (r) => r.migration_name,
    ),
  );
  const names = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  let applied = 0;
  for (const name of names) {
    if (done.has(name)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(
        `INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","applied_steps_count") VALUES ($1,$2,now(),$3,1)`,
        [randomUUID(), checksum, name],
      );
    });
    console.log(`  ✔ ترحيل قاعدة البيانات: ${name}`);
    applied++;
  }
  return applied;
}

/** يفتح القاعدة المدمجة ويطبّق الترحيلات. لا يجوز فتحها من برنامجين في نفس الوقت. */
export async function openLocalDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  fs.mkdirSync(path.dirname(path.resolve(LOCAL_DB_DIR)), { recursive: true });
  const db = await PGlite.create(LOCAL_DB_DIR);
  await applyMigrations(db);
  return db;
}
