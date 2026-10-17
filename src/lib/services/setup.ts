import type { PrismaClient } from "@prisma/client";

export const DEFAULT_UNITS = ["قطعة", "متر", "متر مربع", "كيلوغرام", "لوح", "لتر", "علبة", "طقم"];
export const DEFAULT_ITEM_CATEGORIES = ["أخشاب", "إسفنج", "أقمشة", "براغي ومسامير", "إكسسوارات", "دهانات وغراء", "كراسي", "كنب", "أسرّة", "طاولات", "خزائن"];
export const DEFAULT_EXPENSE_CATEGORIES = ["إيجار", "كهرباء", "مياه", "نقل ومواصلات", "صيانة", "مصاريف مكتبية", "اتصالات وإنترنت", "وقود", "أجور يومية (عمال غير مسجلين)", "مصاريف تشغيلية أخرى"];
export const DEFAULT_INCOME_CATEGORIES = ["بيع خردة ونفايات خشب", "خدمات نقل وتركيب", "إيرادات أخرى"];

/** ينشئ الإعدادات والقوائم الافتراضية إن لم تكن موجودة (آمن للتكرار). */
export async function ensureDefaults(db: PrismaClient) {
  await db.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  for (const name of DEFAULT_UNITS) {
    await db.unit.upsert({ where: { name }, create: { name }, update: {} });
  }
  const cats: [string[], string][] = [
    [DEFAULT_ITEM_CATEGORIES, "ITEM"],
    [DEFAULT_EXPENSE_CATEGORIES, "EXPENSE"],
    [DEFAULT_INCOME_CATEGORIES, "INCOME"],
  ];
  for (const [names, kind] of cats) {
    for (const name of names) {
      await db.category.upsert({ where: { name_kind: { name, kind } }, create: { name, kind }, update: {} });
    }
  }
  const accounts = await db.cashAccount.count();
  if (accounts === 0) {
    await db.cashAccount.create({
      data: { name: "الخزينة الرئيسية", type: "CASH", openingBalance: 0, openingDate: new Date("2000-01-01T00:00:00Z") },
    });
  }
}
