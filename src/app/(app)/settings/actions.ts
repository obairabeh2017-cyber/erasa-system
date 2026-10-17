"use server";

import path from "node:path";
import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { audit } from "@/lib/audit";
import { createBackup, verifyDatabaseFile, resolveDbPath } from "@/lib/services/backup";
import { checkStockIntegrity } from "@/lib/services/inventory";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { clearSession, requireOwner } from "@/lib/auth/owner";
import { BusinessError } from "@/lib/errors";

export const saveSettingsAction = ownerAction(async (fd) => {
  const data = {
    companyName: f.text(fd, "companyName", "اسم الشركة"),
    companyPhone: f.optText(fd, "companyPhone", 40),
    companyAddress: f.optText(fd, "companyAddress", 200),
    invoiceFooter: f.optText(fd, "invoiceFooter", 300),
    backupKeep: f.int(fd, "backupKeep", "عدد النسخ المحفوظة", 1, 365),
    backupIntervalHours: f.int(fd, "backupIntervalHours", "فترة النسخ التلقائي", 1, 720),
    debtReminderDaysAhead: f.int(fd, "debtReminderDaysAhead", "أيام التذكير قبل الاستحقاق", 0, 60),
    salaryDayOfMonth: f.int(fd, "salaryDayOfMonth", "يوم الرواتب", 1, 31),
    salaryReminderDays: f.int(fd, "salaryReminderDays", "أيام التذكير قبل الرواتب", 0, 31),
  };
  await prisma.appSettings.update({ where: { id: 1 }, data });
  await audit(prisma, "SETTINGS_UPDATED", "AppSettings", 1, data);
  return { message: "تم حفظ الإعدادات" };
});

export const changePasswordAction = ownerAction(async (fd) => {
  const owner = await requireOwner();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (!(await verifyPassword(current, owner.passwordHash))) throw new BusinessError("كلمة المرور الحالية غير صحيحة");
  if (next !== confirm) throw new BusinessError("تأكيد كلمة المرور غير مطابق");
  const weak = validatePasswordStrength(next);
  if (weak) throw new BusinessError(weak);
  // زيادة نسخة الجلسة تُبطل كل الجلسات القديمة (على كل الأجهزة)
  await prisma.ownerSettings.update({ where: { id: 1 }, data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } } });
  await audit(prisma, "PASSWORD_CHANGED", "OwnerSettings", 1);
  return { message: "تم تغيير كلمة المرور. سجّل الدخول من جديد." };
});

export const logoutEverywhereAction = ownerAction(async () => {
  await prisma.ownerSettings.update({ where: { id: 1 }, data: { sessionVersion: { increment: 1 } } });
  await clearSession();
  return "/login";
});

export const backupNowAction = ownerAction(async (fd) => {
  const s = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  const label = f.optText(fd, "label", 30) ?? "manual";
  const r = await createBackup(prisma, { keep: s.backupKeep, label });
  await audit(prisma, "BACKUP_CREATED", "Backup", null, { file: path.basename(r.file) });
  return { message: `تم إنشاء النسخة: ${path.basename(r.file)} (${Math.round(r.size / 1024)} KB) وفُحصت سلامتها` };
});

export const integrityAction = ownerAction(async () => {
  const db = await verifyDatabaseFile(resolveDbPath());
  const stock = await checkStockIntegrity(prisma);
  const problems: string[] = [];
  if (!db.ok) problems.push(`سلامة قاعدة البيانات: ${db.result}`);
  for (const m of stock.mismatches) problems.push(`الصنف ${m.sku}: الرصيد المخزن لا يطابق مجموع الحركات`);
  if (problems.length) throw new BusinessError(problems.join(" | "));
  return { message: `قاعدة البيانات سليمة، وأرصدة ${stock.checked} صنف تطابق حركات المخزون` };
});

export const addCategoryAction = ownerAction(async (fd) => {
  const kind = f.oneOf(fd, "kind", ["ITEM", "EXPENSE", "INCOME"] as const, "نوع الفئة");
  await prisma.category.create({ data: { name: f.text(fd, "name", "اسم الفئة", 60), kind } });
  return { message: "تمت إضافة الفئة" };
});

export const renameCategoryAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الفئة");
  await prisma.category.update({ where: { id }, data: { name: f.text(fd, "name", "اسم الفئة", 60) } });
  return { message: "تم تعديل الفئة" };
});

export const addUnitAction = ownerAction(async (fd) => {
  await prisma.unit.create({ data: { name: f.text(fd, "name", "اسم الوحدة", 30) } });
  return { message: "تمت إضافة الوحدة" };
});
