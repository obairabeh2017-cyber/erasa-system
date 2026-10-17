import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// يُنشئ قاعدة بيانات قالب مُرحّلة بالترحيلات الحقيقية (prisma migrate deploy) لاستخدامها في الاختبارات.
export default function setup() {
  const dir = path.resolve(process.cwd(), "test-data");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const template = path.join(dir, "template.db");
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: "file:../test-data/template.db" },
    cwd: process.cwd(),
  });
  process.env.TEST_TEMPLATE_DB = template;
}
