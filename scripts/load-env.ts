// يحمّل ملف .env لسكربتات سطر الأوامر (يجب استيراده أولاً في كل سكربت).
import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✖ DATABASE_URL غير مضبوط. انسخ .env.example إلى .env وشغّل الأمر من مجلد البرنامج.");
  process.exit(1);
}
// المسار النسبي يُحسب من مجلد prisma (كما يفسّره Prisma) ويُحوّل إلى مطلق
if (url.startsWith("file:") && !path.isAbsolute(url.slice(5).split("?")[0])) {
  process.env.DATABASE_URL = "file:" + path.resolve(process.cwd(), "prisma", url.slice(5));
}
