import type { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./session";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";
import { onCloud } from "../cloud";

/** يتحقق من رمز الجلسة ومن أن نسخة الجلسة لم تُبطَل (مثلاً بعد تغيير كلمة المرور). */
export async function authorizeToken(db: PrismaClient, token: string | undefined | null) {
  const s = await verifySession(token);
  if (!s) return null;
  const owner = await db.ownerSettings.findUnique({ where: { id: 1 } });
  if (!owner || owner.sessionVersion !== s.v) return null;
  return owner;
}

export async function getOwner() {
  const jar = await cookies();
  return authorizeToken(prisma, jar.get(SESSION_COOKIE)?.value);
}

/** يُستدعى في كل صفحة وكل إجراء خادم: يمنع أي وصول بدون جلسة مالك صالحة. */
export async function requireOwner() {
  const owner = await getOwner();
  if (!owner) redirect("/login");
  return owner;
}

export const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

/**
 * إنشاء حساب المالك عند أول تشغيل على الاستضافة السحابية من متغيرات البيئة
 * OWNER_USERNAME و OWNER_PASSWORD (لا توجد صفحة تسجيل عامة).
 */
export async function bootstrapOwnerFromEnv(db: PrismaClient) {
  const username = process.env.OWNER_USERNAME?.trim() || "owner";
  const password = process.env.OWNER_PASSWORD;
  if (!username || !password) return null;
  if (validatePasswordStrength(password)) return null;
  const existing = await db.ownerSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  try {
    return await db.ownerSettings.create({ data: { id: 1, username, passwordHash: await hashPassword(password) } });
  } catch {
    return db.ownerSettings.findUnique({ where: { id: 1 } });
  }
}

/**
 * التحقق من بيانات الدخول مع حد للمحاولات الفاشلة مخزّن في قاعدة البيانات
 * (يعمل حتى مع عدة نسخ من الخادم السحابي). يعيد رسالة خطأ أو null عند النجاح.
 */
export async function checkCredentials(db: PrismaClient, username: string, password: string, key: string): Promise<string | null> {
  const now = new Date();
  const attempt = await db.loginAttempt.findUnique({ where: { key } });
  if (attempt && attempt.count >= MAX_FAILS && attempt.until > now) {
    return "تم إيقاف الدخول مؤقتاً بسبب محاولات فاشلة متكررة. حاول بعد 15 دقيقة.";
  }
  const owner = (await db.ownerSettings.findUnique({ where: { id: 1 } })) ?? (await bootstrapOwnerFromEnv(db));
  const ok = !!owner && owner.username === username && (await verifyPassword(password, owner.passwordHash));
  if (!ok) {
    const fresh = !attempt || attempt.until <= now;
    await db.loginAttempt.upsert({
      where: { key },
      create: { key, count: 1, until: new Date(now.getTime() + LOCK_MS) },
      update: fresh ? { count: 1, until: new Date(now.getTime() + LOCK_MS) } : { count: { increment: 1 } },
    });
    if (!owner) return "لم يتم إعداد حساب المالك بعد: أضف المتغير OWNER_PASSWORD (كلمة مرور قوية: 8 أحرف على الأقل فيها أرقام وحروف) ثم أعد النشر، أو شغّل npm run owner:set";
    return "اسم المستخدم أو كلمة المرور غير صحيحة";
  }
  await db.loginAttempt.deleteMany({ where: { key } });
  return null;
}

export async function attemptLogin(username: string, password: string, key: string): Promise<string | null> {
  const err = await checkCredentials(prisma, username, password, key);
  if (err) return err;
  const owner = await prisma.ownerSettings.findUniqueOrThrow({ where: { id: 1 } });
  const token = await signSession(owner.sessionVersion);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // على الاستضافة السحابية يكون الاتصال HTTPS دائماً
    secure: process.env.COOKIE_SECURE === "true" || onCloud(),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return null;
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
