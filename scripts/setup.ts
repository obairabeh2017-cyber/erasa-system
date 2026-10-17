// تهيئة القوائم الافتراضية (وحدات، فئات، الخزينة الرئيسية). آمن للتكرار.
import "./load-env";
import { PrismaClient } from "@prisma/client";
import { ensureDefaults } from "../src/lib/services/setup";

const db = new PrismaClient();
ensureDefaults(db)
  .then(async () => {
    const owner = await db.ownerSettings.count();
    console.log("✔ تمت تهيئة القوائم الافتراضية.");
    if (!owner) console.log("ℹ الخطوة التالية: أنشئ حساب المالك بالأمر  npm run owner:set");
  })
  .catch((e) => {
    console.error("✖", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
