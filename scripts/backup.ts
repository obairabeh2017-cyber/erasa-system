// نسخة احتياطية يدوية من سطر الأوامر: npm run db:backup -- [وسم]
// آمنة حتى أثناء تشغيل البرنامج (تستخدم VACUUM INTO).
import "./load-env";
import { PrismaClient } from "@prisma/client";
import { createBackup } from "../src/lib/services/backup";

const db = new PrismaClient();
(async () => {
  const s = await db.appSettings.findUnique({ where: { id: 1 } });
  const r = await createBackup(db, { keep: s?.backupKeep ?? 30, label: process.argv[2] ?? "cli" });
  console.log(`✔ تم إنشاء النسخة وفحص سلامتها: ${r.file} (${Math.round(r.size / 1024)} KB)`);
})()
  .catch((e) => {
    console.error("✖", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
