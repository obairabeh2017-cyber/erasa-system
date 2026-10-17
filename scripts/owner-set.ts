// إنشاء حساب المالك أو تغيير كلمة مروره (يُستخدم أيضاً لاستعادة الدخول عند نسيان كلمة المرور).
// الاستخدام:  npm run owner:set
//        أو:  npm run owner:set -- --username admin --password "كلمة-مرور-قوية1"
import "./load-env";
import { PrismaClient } from "@prisma/client";
import readline from "node:readline";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";
import { ensureDefaults } from "../src/lib/services/setup";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function ask(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // إخفاء كلمة المرور أثناء الكتابة
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(question)) out.output.write(s);
      else out.output.write("*");
    };
  }
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); }));
}

async function main() {
  const db = new PrismaClient();
  await ensureDefaults(db);
  const existing = await db.ownerSettings.findUnique({ where: { id: 1 } });
  const username = arg("username") ?? (await ask(`اسم المستخدم${existing ? ` [${existing.username}]` : ""}: `)) ?? "";
  const finalUser = username || existing?.username;
  if (!finalUser) throw new Error("اسم المستخدم مطلوب");
  const password = arg("password") ?? (await ask("كلمة المرور الجديدة: ", true));
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(weak);
  if (!arg("password")) {
    const again = await ask("أعد كتابة كلمة المرور: ", true);
    if (again !== password) throw new Error("كلمتا المرور غير متطابقتين");
  }
  const passwordHash = await hashPassword(password);
  await db.ownerSettings.upsert({
    where: { id: 1 },
    create: { id: 1, username: finalUser, passwordHash },
    // زيادة نسخة الجلسة تُخرج أي جهاز مسجّل دخوله بكلمة المرور القديمة
    update: { username: finalUser, passwordHash, sessionVersion: { increment: 1 } },
  });
  await db.auditLog.create({ data: { action: existing ? "OWNER_PASSWORD_RESET_CLI" : "OWNER_CREATED_CLI", entityType: "OwnerSettings", entityId: 1 } });
  console.log(existing ? "✔ تم تحديث بيانات دخول المالك." : "✔ تم إنشاء حساب المالك.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
