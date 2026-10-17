// استعادة نسخة احتياطية — أوقف البرنامج أولاً (أغلق نافذة التشغيل).
// الاستخدام: npm run db:restore -- furniture-20261017-120000-auto.db
import "./load-env";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import readline from "node:readline";
import { backupDir, resolveDbPath, restoreBackup } from "../src/lib/services/backup";


async function confirm(q: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise<string>((r) => rl.question(q, r));
  rl.close();
  return ["y", "yes", "نعم", "ن"].includes(a.trim().toLowerCase());
}

(async () => {
  const name = process.argv[2];
  if (!name) {
    console.log("حدد اسم ملف النسخة. النسخ المتوفرة في:", backupDir());
    for (const f of fs.readdirSync(backupDir()).filter((f) => f.endsWith(".db")).sort().reverse().slice(0, 15)) console.log("  ", f);
    process.exit(1);
  }
  const file = fs.existsSync(name) ? path.resolve(name) : path.join(backupDir(), name);
  if (!fs.existsSync(file)) throw new Error(`الملف غير موجود: ${file}`);
  const target = resolveDbPath();
  console.log(`سيتم استبدال قاعدة البيانات:\n  ${target}\nبالنسخة:\n  ${file}\n(تُحفظ نسخة من القاعدة الحالية قبل الاستبدال)`);
  if (!process.argv.includes("--yes") && !(await confirm("هل البرنامج متوقف وتريد المتابعة؟ (نعم/لا): "))) {
    console.log("أُلغيت الاستعادة.");
    return;
  }
  const r = await restoreBackup(file, target, backupDir());
  console.log("✔ تمت الاستعادة وفحص سلامة القاعدة (integrity_check = ok).");
  if (r.safetyCopy) console.log(`  نسخة القاعدة السابقة: ${r.safetyCopy}`);
  // إن كانت النسخة أقدم من الترحيلات الحالية، تُطبّق الترحيلات الناقصة
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  console.log("✔ جاهز. شغّل البرنامج من جديد.");
})().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
