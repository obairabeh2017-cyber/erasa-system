// نسخة احتياطية من سطر الأوامر (ملف JSON كامل): npm run db:backup
// تعمل مع قاعدة Neon المحددة في DATABASE_URL داخل ملف .env
import "./load-env";
import { PrismaClient } from "@prisma/client";
import { writeBackupFile } from "../src/lib/services/backup";

const db = new PrismaClient();
(async () => {
  const s = await db.appSettings.findUnique({ where: { id: 1 } });
  const r = await writeBackupFile(db, { keep: s?.backupKeep ?? 30 });
  console.log(`✔ تم إنشاء النسخة: ${r.file} (${Math.round(r.size / 1024)} KB)`);
})()
  .catch((e) => {
    console.error("✖", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
