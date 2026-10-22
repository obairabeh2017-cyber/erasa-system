// أمر البناء على الاستضافة السحابية (Vercel عبر vercel-build، وRender عبر cloud-build):
// التحقق من رابط قاعدة البيانات ← توليد Prisma ← إنشاء/تحديث الجداول (الترحيلات) ← بناء Next.js
// لا يُنشر الموقع أبداً بدون قاعدة بيانات جاهزة.
import { execSync } from "node:child_process";
import { describeDatabaseVars, resolveDatabaseUrls } from "../src/lib/db-env.mjs";

const urls = resolveDatabaseUrls();
if (!urls) {
  const found = describeDatabaseVars();
  console.error(`
✖ لا يوجد رابط قاعدة بيانات PostgreSQL في متغيرات البيئة — أُوقف النشر حتى لا يُنشر موقع معطّل.
  No PostgreSQL database URL found — deployment stopped so a broken site is not published.

  المتغيرات المتعلقة بقاعدة البيانات الموجودة الآن:
${found.length ? found.map((l) => "   - " + l).join("\n") : "   (لا يوجد أي متغير — DATABASE_URL غير موجود إطلاقاً)"}

  الحل في Vercel:
   المشروع ← Storage ← Create Database ← Neon (أو Connect لقاعدة موجودة) ← اربطها بـ Production
   ثم Deployments ← آخر نشر ← ⋯ ← Redeploy
  الحل في Render:
   الخدمة ← Environment ← DATABASE_URL = رابط Neon (يبدأ بـ postgresql://)
   ثم Manual Deploy ← Deploy latest commit
`);
  process.exit(1);
}

console.log(`✔ قاعدة البيانات: ${urls.pooled.name} (للتطبيق)، ${urls.direct.name} (للترحيلات)`);

const run = (cmd, env) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

run("npx prisma generate", { DATABASE_URL: urls.pooled.value });
console.log("… إنشاء/تحديث جداول قاعدة البيانات (prisma migrate deploy)");
run("npx prisma migrate deploy", { DATABASE_URL: urls.direct.value });
run("npx next build", { DATABASE_URL: urls.pooled.value });
