import { createHash, timingSafeEqual } from "node:crypto";
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
  return (await bootstrapOwnerWithReason(db)).owner;
}

/** بيانات المالك من متغيرات البيئة، أو null إن لم تُضبط OWNER_PASSWORD (المسافات في الطرفين تُهمل). */
function envOwner() {
  const password = process.env.OWNER_PASSWORD?.trim();
  if (!password) return null;
  return { username: process.env.OWNER_USERNAME?.trim() || "owner", password };
}

/** اسم المستخدم لا يفرّق بين الأحرف الكبيرة والصغيرة (EHAB = ehab). */
function sameUsername(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function samePassword(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** مثل bootstrapOwnerFromEnv لكن يعيد أيضاً سبب عدم الإنشاء (لعرض رسالة واضحة للمالك). */
export async function bootstrapOwnerWithReason(db: PrismaClient) {
  const env = envOwner();
  if (!env) return { owner: null, reason: "missing" as const };
  const weak = validatePasswordStrength(env.password);
  if (weak) return { owner: null, reason: "weak" as const, detail: weak };
  const existing = await db.ownerSettings.findUnique({ where: { id: 1 } });
  if (existing) return { owner: existing, reason: null };
  try {
    const owner = await db.ownerSettings.create({ data: { id: 1, username: env.username, passwordHash: await hashPassword(env.password) } });
    return { owner, reason: null };
  } catch (e) {
    const owner = await db.ownerSettings.findUnique({ where: { id: 1 } });
    if (!owner) console.error("[auth] owner bootstrap failed", e);
    return { owner, reason: owner ? null : ("error" as const) };
  }
}

/**
 * على الاستضافة السحابية لا يوجد سطر أوامر لـ npm run owner:set، فإن طابق الدخولُ
 * OWNER_USERNAME و OWNER_PASSWORD الحاليين يُعاد ضبط الحساب ليطابقهما
 * (مثلاً إذا أُنشئ الحساب باسم مستخدم قديم ثم عُدّل المتغير). لذلك يُحذف OWNER_PASSWORD بعد الدخول.
 */
async function resetOwnerFromEnv(db: PrismaClient, username: string, password: string) {
  const env = envOwner();
  if (!onCloud() || !env || validatePasswordStrength(env.password)) return false;
  if (!sameUsername(env.username, username) || !samePassword(password, env.password)) return false;
  await db.ownerSettings.update({
    where: { id: 1 },
    data: { username: env.username, passwordHash: await hashPassword(env.password), sessionVersion: { increment: 1 } },
  });
  await db.auditLog.create({ data: { action: "OWNER_RESET_ENV", entityType: "OwnerSettings", entityId: 1 } });
  return true;
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
  let owner = await db.ownerSettings.findUnique({ where: { id: 1 } });
  if (!owner) {
    // لا يوجد مالك بعد: لا تُحتسب هذه محاولة فاشلة، بل تُعرض سبب عدم إنشاء الحساب بوضوح
    const boot = await bootstrapOwnerWithReason(db);
    if (!boot.owner) {
      if (boot.reason === "weak") {
        return `كلمة المرور في المتغير OWNER_PASSWORD مرفوضة: ${boot.detail}. عدّلها في إعدادات الاستضافة ثم أعد النشر.`;
      }
      if (boot.reason === "error") return "تعذر إنشاء حساب المالك بسبب خطأ في قاعدة البيانات. راجع سجلات الخادم.";
      return "لم يتم إعداد حساب المالك بعد: أضف المتغير OWNER_PASSWORD (8 أحرف على الأقل فيها أرقام وحروف) ثم أعد النشر، أو شغّل npm run owner:set";
    }
    owner = boot.owner;
  }
  const ok =
    (sameUsername(owner.username, username) && (await verifyPassword(password, owner.passwordHash))) ||
    (await resetOwnerFromEnv(db, username, password));
  if (!ok) {
    const fresh = !attempt || attempt.until <= now;
    await db.loginAttempt.upsert({
      where: { key },
      create: { key, count: 1, until: new Date(now.getTime() + LOCK_MS) },
      update: fresh ? { count: 1, until: new Date(now.getTime() + LOCK_MS) } : { count: { increment: 1 } },
    });
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
