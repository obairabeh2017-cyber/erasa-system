import { BusinessError } from "./errors";

// إيصالات المصروفات تُحفظ داخل قاعدة البيانات (جدول Attachment) لأن الاستضافة السحابية
// لا تملك قرصاً دائماً. لا تُقدَّم إلا عبر مسار محمي بجلسة المالك.
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
// حد Vercel لحجم الطلب 4.5 ميغابايت
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

export type ReceiptUpload = { name: string; mime: string; size: number; data: Uint8Array<ArrayBuffer> };

/** يقرأ ملف الإيصال من النموذج ويتحقق منه، أو يعيد null إن لم يُرفع ملف. */
export async function readReceipt(file: FormDataEntryValue | null): Promise<ReceiptUpload | null> {
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (!ALLOWED.includes(file.type)) throw new BusinessError("نوع ملف الإيصال غير مدعوم (المسموح: JPG, PNG, WEBP, PDF)");
  if (file.size > MAX_RECEIPT_BYTES) throw new BusinessError("حجم ملف الإيصال أكبر من 4 ميغابايت");
  return { name: file.name.slice(0, 120), mime: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()) };
}
