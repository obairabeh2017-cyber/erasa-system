// أمر البناء على الاستضافة السحابية (Render): توليد Prisma ← تطبيق الترحيلات ← بناء Next.js
import { execSync } from "node:child_process";
import { resolveDatabaseUrls } from "../src/lib/db-env.mjs";

const urls = resolveDatabaseUrls();
if (!urls) {
  console.error(`
✖ لا يوجد رابط قاعدة بيانات PostgreSQL في متغيرات البيئة.
  No PostgreSQL database URL found (DATABASE_URL is missing or not a postgresql:// URL).

  الحل في Render:
   Dashboard ← خدمة erasa-system ← Environment ← DATABASE_URL = رابط Neon
   (من لوحة Neon: Connect ← انسخ Connection string)
   ثم: Manual Deploy ← Deploy latest commit
`);
  process.exit(1);
}

console.log(`✔ قاعدة البيانات: ${urls.pooled.name} (للتطبيق)، ${urls.direct.name} (للترحيلات)`);

const run = (cmd, env) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

run("npx prisma generate", { DATABASE_URL: urls.pooled.value });
run("npx prisma migrate deploy", { DATABASE_URL: urls.direct.value });
run("npx next build", { DATABASE_URL: urls.pooled.value });
