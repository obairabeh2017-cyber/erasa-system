// يحمّل ملف .env لسكربتات سطر الأوامر (يجب استيراده أولاً في كل سكربت).
import fs from "node:fs";
import { resolveDatabaseUrls } from "../src/lib/db-env.mjs";

if (fs.existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
const urls = resolveDatabaseUrls();
if (!urls) {
  console.error("✖ لا يوجد رابط قاعدة بيانات PostgreSQL. ضع DATABASE_URL (رابط Neon) في ملف .env وشغّل الأمر من مجلد البرنامج.");
  process.exit(1);
}
// السكربتات (استعادة، إنشاء المالك...) تستخدم الاتصال المباشر
process.env.DATABASE_URL = urls.direct.value;
