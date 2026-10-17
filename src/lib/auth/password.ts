import bcrypt from "bcryptjs";

const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function validatePasswordStrength(p: string): string | null {
  if (p.length < 8) return "كلمة المرور يجب ألا تقل عن 8 أحرف";
  if (!/[0-9]/.test(p) || !/[^0-9]/.test(p)) return "كلمة المرور يجب أن تحتوي على أرقام وحروف";
  return null;
}
