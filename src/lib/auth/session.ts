// توقيع الجلسة والتحقق منها — يعمل في middleware (Edge) وفي الخادم.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "fm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // أسبوع

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET غير مضبوط أو أقصر من 32 حرفاً (راجع ملف .env)");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(sessionVersion: number): Promise<string> {
  return new SignJWT({ v: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined | null): Promise<{ v: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.sub !== "owner" || typeof payload.v !== "number") return null;
    return { v: payload.v };
  } catch {
    return null;
  }
}
