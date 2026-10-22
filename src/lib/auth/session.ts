// توقيع الجلسة والتحقق منها — يعمل في middleware (Edge) وفي الخادم.
import { SignJWT, jwtVerify } from "jose";
import { resolveDatabaseUrls } from "../db-env.mjs";

export const SESSION_COOKIE = "fm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // أسبوع

let cachedKey: Promise<Uint8Array> | null = null;

/**
 * مفتاح توقيع الجلسة:
 * - SESSION_SECRET إن وُجد (32 حرفاً على الأقل) — الخيار الموصى به.
 * - وإلا على الاستضافة السحابية: يُشتق تلقائياً (SHA-256) من رابط قاعدة البيانات السري،
 *   فيكون فريداً لكل قاعدة ولا يحتاج المالك لإدخال مفتاح يدوياً.
 */
async function deriveKey(): Promise<Uint8Array> {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  const urls = resolveDatabaseUrls();
  if (urls) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`erasa-session-v1:${urls.direct.value}`));
    return new Uint8Array(digest);
  }
  throw new Error("SESSION_SECRET غير مضبوط أو أقصر من 32 حرفاً (راجع ملف .env)");
}

function secretKey(): Promise<Uint8Array> {
  cachedKey ??= deriveKey().catch((e) => {
    cachedKey = null;
    throw e;
  });
  return cachedKey;
}

export async function signSession(sessionVersion: number): Promise<string> {
  return new SignJWT({ v: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(await secretKey());
}

export async function verifySession(token: string | undefined | null): Promise<{ v: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await secretKey(), { algorithms: ["HS256"] });
    if (payload.sub !== "owner" || typeof payload.v !== "number") return null;
    return { v: payload.v };
  } catch {
    return null;
  }
}
