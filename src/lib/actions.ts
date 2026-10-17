import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireOwner } from "./auth/owner";
import { BusinessError, isUniqueViolation } from "./errors";

export type ActionState = { ok?: boolean; error?: string; message?: string; at?: number };
type Result = string | void | { message: string };

export function toArabicError(e: unknown): string {
  if (e instanceof BusinessError) return e.message;
  if (e instanceof ZodError) return e.issues[0]?.message ?? "بيانات غير صالحة";
  if (isUniqueViolation(e)) return "القيمة مستخدمة مسبقاً (يجب أن تكون فريدة)";
  console.error(e);
  return "حدث خطأ غير متوقع. لم يتم حفظ أي تغيير.";
}

/**
 * غلاف إلزامي لكل إجراء خادم: يتحقق من جلسة المالك أولاً، ثم ينفذ الإجراء،
 * ويحوّل الأخطاء إلى رسائل عربية. إذا أعاد الإجراء نصاً فهو مسار إعادة التوجيه.
 */
export function ownerAction(fn: (fd: FormData) => Promise<Result>) {
  return async (_prev: ActionState | undefined, fd: FormData): Promise<ActionState> => {
    await requireOwner();
    let to: string | undefined;
    let message: string | undefined;
    try {
      const r = await fn(fd);
      if (typeof r === "string") to = r;
      else if (r) message = r.message;
    } catch (e) {
      return { error: toArabicError(e), at: Date.now() };
    }
    revalidatePath("/", "layout");
    if (to) redirect(to);
    return { ok: true, message: message ?? "تم الحفظ", at: Date.now() };
  };
}
