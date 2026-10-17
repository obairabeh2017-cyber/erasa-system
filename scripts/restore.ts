// استعادة نسخة احتياطية (ملف JSON) إلى قاعدة البيانات المحددة في DATABASE_URL.
// الاستخدام: npm run db:restore -- erasa-backup-20261018-060000.json [--replace]
//   --replace : يمسح البيانات الحالية ويستبدلها (داخل معاملة واحدة: إن فشلت الاستعادة لا يتغير شيء)
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PrismaClient } from "@prisma/client";
import { backupDir, importAll, type BackupDump } from "../src/lib/services/backup";

async function confirm(q: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise<string>((r) => rl.question(q, r));
  rl.close();
  return ["y", "yes", "نعم", "ن"].includes(a.trim().toLowerCase());
}

(async () => {
  const name = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const replace = process.argv.includes("--replace");
  if (!name) {
    console.log("حدد ملف النسخة. مثال: npm run db:restore -- erasa-backup-20261018-060000.json --replace");
    process.exit(1);
  }
  const file = fs.existsSync(name) ? path.resolve(name) : path.join(backupDir(), name);
  if (!fs.existsSync(file)) throw new Error(`الملف غير موجود: ${file}`);
  const dump = JSON.parse(fs.readFileSync(file, "utf8")) as BackupDump;
  const host = (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//***@").split("?")[0];
  console.log(`النسخة: ${file}\nبتاريخ: ${dump.exportedAt}\nالقاعدة الهدف: ${host}`);
  console.log(Object.entries(dump.counts).filter(([, n]) => n > 0).map(([k, n]) => `  ${k}: ${n}`).join("\n"));
  if (replace) console.log("⚠️ سيتم استبدال كل البيانات الحالية في القاعدة الهدف.");
  if (!process.argv.includes("--yes") && !(await confirm("متابعة؟ (نعم/لا): "))) {
    console.log("أُلغيت الاستعادة.");
    return;
  }
  const db = new PrismaClient();
  try {
    await importAll(db, dump, { replace });
    console.log("✔ تمت الاستعادة، وتطابق عدد السجلات في كل جدول، وأرصدة المخزون سليمة.");
  } finally {
    await db.$disconnect();
  }
})().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
