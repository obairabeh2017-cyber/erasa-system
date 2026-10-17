import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BusinessError } from "./errors";

// المرفقات تُحفظ خارج مجلد public ولا تُقدَّم إلا عبر مسار محمي بجلسة المالك.
export function storageDir(): string {
  return path.resolve(process.cwd(), process.env.STORAGE_DIR || "./storage");
}

const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};
export const MIME_BY_EXT: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" };
const MAX = 5 * 1024 * 1024;

/** يحفظ ملف إيصال ويعيد المسار النسبي داخل مجلد التخزين، أو null إن لم يُرفع ملف. */
export async function saveReceipt(file: FormDataEntryValue | null): Promise<{ path: string; name: string } | null> {
  if (!file || typeof file === "string" || file.size === 0) return null;
  const ext = ALLOWED[file.type];
  if (!ext) throw new BusinessError("نوع ملف الإيصال غير مدعوم (المسموح: JPG, PNG, WEBP, PDF)");
  if (file.size > MAX) throw new BusinessError("حجم ملف الإيصال أكبر من 5 ميغابايت");
  const rel = path.join("receipts", `${randomUUID()}${ext}`);
  const abs = path.join(storageDir(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()));
  return { path: rel.split(path.sep).join("/"), name: file.name.slice(0, 120) };
}

/** يحلّ مساراً مخزّناً بأمان (يمنع الخروج من مجلد التخزين). */
export function resolveStored(rel: string): string | null {
  const base = storageDir();
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base + path.sep)) return null;
  return abs;
}
