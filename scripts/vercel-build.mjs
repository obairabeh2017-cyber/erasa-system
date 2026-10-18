// أمر البناء على Vercel: توليد Prisma ← تطبيق الترحيلات (اتصال مباشر) ← بناء Next.js
import { execSync } from "node:child_process";
import { resolveDatabaseUrls } from "../src/lib/db-env.mjs";

const urls = resolveDatabaseUrls();
if (!urls) {
  console.error(`
✖ لا يوجد رابط قاعدة بيانات PostgreSQL في متغيرات البيئة.
  No PostgreSQL database URL found in the environment variables.

  الحل في Vercel:
   1) افتح المشروع ← تبويب Storage ← Create Database ← Neon (أو Connect Database إن كانت موجودة)
   2) اربطها بالمشروع لبيئة Production (وPreview إن أردت)
   3) Deployments ← آخر نشر ← ⋯ ← Redeploy

  أو أضف يدوياً في Settings ← Environment Variables:
   DATABASE_URL           = رابط Neon عبر pooler
   DATABASE_URL_UNPOOLED  = رابط Neon المباشر
`);
  process.exit(1);
}

console.log(`✔ قاعدة البيانات: ${urls.pooled.name} (للتطبيق)، ${urls.direct.name} (للترحيلات)`);
if (urls.direct.name === urls.pooled.name) {
  console.warn("⚠ لا يوجد رابط مباشر (unpooled)؛ ستُطبّق الترحيلات عبر الرابط نفسه.");
}

const run = (cmd, env) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

run("npx prisma generate", { DATABASE_URL: urls.pooled.value });
run("npx prisma migrate deploy", { DATABASE_URL: urls.direct.value });
run("npx next build", { DATABASE_URL: urls.pooled.value });
