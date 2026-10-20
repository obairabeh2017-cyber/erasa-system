// أمر البناء على الاستضافة السحابية (Render): توليد Prisma ← تطبيق الترحيلات ← بناء Next.js
import { execSync } from "node:child_process";
import { describeDatabaseVars, resolveDatabaseUrls } from "../src/lib/db-env.mjs";

const urls = resolveDatabaseUrls();
if (!urls) {
  const found = describeDatabaseVars();
  console.error(`
✖ لا يوجد رابط قاعدة بيانات PostgreSQL في متغيرات البيئة.
  No PostgreSQL database URL found in the environment variables.

  المتغيرات المتعلقة بقاعدة البيانات الموجودة الآن:
${found.length ? found.map((l) => "   - " + l).join("\n") : "   (لا يوجد أي متغير — DATABASE_URL غير موجود إطلاقاً)"}

  الحل في Render:
   1) افتح الخدمة erasa-system ← Environment ← Add Environment Variable
   2) Key = DATABASE_URL
      Value = رابط Neon (من لوحة Neon: Connect ← انسخ الرابط الذي يبدأ بـ postgresql://)
   3) Save Changes، ثم Manual Deploy ← Deploy latest commit
`);
  process.exit(1);
}

console.log(`✔ قاعدة البيانات: ${urls.pooled.name} (للتطبيق)، ${urls.direct.name} (للترحيلات)`);

const run = (cmd, env) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

run("npx prisma generate", { DATABASE_URL: urls.pooled.value });
run("npx prisma migrate deploy", { DATABASE_URL: urls.direct.value });
run("npx next build", { DATABASE_URL: urls.pooled.value });
