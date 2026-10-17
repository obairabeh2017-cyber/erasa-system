import type { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./session";
import { verifyPassword } from "./password";

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

// حدّ بسيط لمحاولات الدخول الفاشلة (داخل الذاكرة)
const attempts = new Map<string, { count: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function attemptLogin(username: string, password: string, key: string): Promise<string | null> {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.count >= MAX_FAILS && a.until > now) {
    return "تم إيقاف الدخول مؤقتاً بسبب محاولات فاشلة متكررة. حاول بعد 15 دقيقة.";
  }
  const owner = await prisma.ownerSettings.findUnique({ where: { id: 1 } });
  const ok = !!owner && owner.username === username && (await verifyPassword(password, owner.passwordHash));
  if (!ok || !owner) {
    const cur = a && a.until > now ? a : { count: 0, until: now + LOCK_MS };
    cur.count++;
    attempts.set(key, cur);
    if (!owner) return "لم يتم إعداد حساب المالك بعد. شغّل الأمر: npm run owner:set";
    return "اسم المستخدم أو كلمة المرور غير صحيحة";
  }
  attempts.delete(key);
  const token = await signSession(owner.sessionVersion);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return null;
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
