// قراءة حقول النماذج والتحقق منها على الخادم مع رسائل عربية.
import { z } from "zod";
import { BusinessError } from "./errors";
import { parseDecimal } from "./money";
import { isDateInput, parseDateInput } from "./dates";

function raw(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export function text(fd: FormData, name: string, label: string, max = 200): string {
  const v = raw(fd, name);
  if (!v) throw new BusinessError(`الحقل «${label}» مطلوب`);
  if (v.length > max) throw new BusinessError(`الحقل «${label}» طويل جداً`);
  return v;
}

export function optText(fd: FormData, name: string, max = 2000): string | null {
  const v = raw(fd, name);
  if (v.length > max) throw new BusinessError("النص طويل جداً");
  return v || null;
}

/** مبلغ بالدينار → درهم (عدد صحيح). */
export function money(fd: FormData, name: string, label: string, opts: { required?: boolean } = {}): number {
  const v = raw(fd, name);
  if (!v) {
    if (opts.required) throw new BusinessError(`الحقل «${label}» مطلوب`);
    return 0;
  }
  const n = parseDecimal(v, 3);
  if (n === null) throw new BusinessError(`قيمة «${label}» غير صالحة (حتى 3 أرقام عشرية)`);
  if (n < 0) throw new BusinessError(`قيمة «${label}» يجب ألا تكون سالبة`);
  return n;
}

/** كمية → جزء من الألف (عدد صحيح). */
export function qty(fd: FormData, name: string, label: string, opts: { required?: boolean; allowNegative?: boolean } = {}): number {
  const v = raw(fd, name);
  if (!v) {
    if (opts.required) throw new BusinessError(`الحقل «${label}» مطلوب`);
    return 0;
  }
  const n = parseDecimal(v, 3);
  if (n === null) throw new BusinessError(`قيمة «${label}» غير صالحة (حتى 3 أرقام عشرية)`);
  if (!opts.allowNegative && n < 0) throw new BusinessError(`قيمة «${label}» يجب ألا تكون سالبة`);
  return n;
}

export function percentBp(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseDecimal(String(v), 2);
  if (n === null || n < 0 || n > 10000) throw new BusinessError("نسبة الهدر غير صالحة (0 إلى 100)");
  return n;
}

export function id(fd: FormData, name: string, label: string): number {
  const n = Number(raw(fd, name));
  if (!Number.isSafeInteger(n) || n <= 0) throw new BusinessError(`اختر «${label}»`);
  return n;
}

export function optId(fd: FormData, name: string): number | null {
  const v = raw(fd, name);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new BusinessError("قيمة اختيار غير صالحة");
  return n;
}

export function int(fd: FormData, name: string, label: string, min: number, max: number): number {
  const n = Number(raw(fd, name));
  if (!Number.isInteger(n) || n < min || n > max) throw new BusinessError(`قيمة «${label}» يجب أن تكون بين ${min} و${max}`);
  return n;
}

export function date(fd: FormData, name: string, label: string): Date {
  const v = raw(fd, name);
  if (!isDateInput(v)) throw new BusinessError(`تاريخ «${label}» غير صالح`);
  return parseDateInput(v);
}

export function optDate(fd: FormData, name: string): Date | null {
  const v = raw(fd, name);
  if (!v) return null;
  if (!isDateInput(v)) throw new BusinessError("تاريخ غير صالح");
  return parseDateInput(v);
}

export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}

export function oneOf<T extends string>(fd: FormData, name: string, values: readonly T[], label: string): T {
  const v = raw(fd, name) as T;
  if (!values.includes(v)) throw new BusinessError(`اختر «${label}»`);
  return v;
}

const decimalStr = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = String(v).trim();
  const n = s === "" ? 0 : parseDecimal(s, 3);
  if (n === null) {
    ctx.addIssue({ code: "custom", message: "قيمة رقمية غير صالحة في أحد الأسطر (حتى 3 أرقام عشرية)" });
    return z.NEVER;
  }
  return n;
});
const lineId = z.coerce.number({ message: "اختر الصنف في كل سطر" }).int().positive("اختر الصنف في كل سطر");

export const priceLinesSchema = z
  .array(z.object({ itemId: lineId, qty: decimalStr, price: decimalStr, discount: decimalStr.optional() }))
  .min(1, "أضف سطراً واحداً على الأقل");

export const recipeLinesSchema = z
  .array(z.object({ materialId: lineId, qty: decimalStr, waste: z.union([z.string(), z.number()]).optional() }))
  .min(1, "أضف مادة خام واحدة على الأقل");

export const materialLinesSchema = z.array(z.object({ materialId: lineId, actualQty: decimalStr }));

export const returnLinesSchema = z.array(z.object({ saleItemId: z.coerce.number().int().positive(), qty: decimalStr }));

export const allocationLinesSchema = z.array(
  z.object({ type: z.enum(["sale", "purchase", "expense", "otherIncome"]), id: z.coerce.number().int().positive(), amount: decimalStr }),
);

export function jsonField<T>(fd: FormData, name: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw(fd, name) || "[]");
  } catch {
    throw new BusinessError("بيانات الأسطر غير صالحة");
  }
  return schema.parse(parsed);
}
