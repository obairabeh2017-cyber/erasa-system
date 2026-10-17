"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { audit } from "@/lib/audit";
import { createExpense, createOtherIncome, voidExpense, voidOtherIncome } from "@/lib/services/expenses";
import { createPayment } from "@/lib/services/payments";
import { saveReceipt } from "@/lib/storage";
import { BusinessError } from "@/lib/errors";
import { dayOfPeriod, isPeriod } from "@/lib/dates";

export const createExpenseAction = ownerAction(async (fd) => {
  const payment = f.oneOf(fd, "payment", ["now", "later", "employee"] as const, "طريقة السداد");
  const input = {
    date: f.date(fd, "date", "التاريخ"),
    categoryId: f.id(fd, "categoryId", "الفئة"),
    description: f.text(fd, "description", "الوصف"),
    amount: f.money(fd, "amount", "المبلغ", { required: true }),
    dueDate: f.optDate(fd, "dueDate"),
    employeeId: f.optId(fd, "employeeId"),
    paidByEmployeeId: payment === "employee" ? f.id(fd, "paidByEmployeeId", "الموظف الذي دفع") : null,
    notes: f.optText(fd, "notes"),
    payNow: payment === "now" ? { accountId: f.id(fd, "accountId", "الحساب"), method: f.optText(fd, "method") ?? "CASH", reference: f.optText(fd, "reference") } : null,
  };
  const receipt = await saveReceipt(fd.get("receipt"));
  const e = await createExpense(prisma, { ...input, receiptPath: receipt?.path, receiptName: receipt?.name });
  return `/expenses/${e.id}`;
});

export const payExpenseAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "المصروف");
  const amount = f.money(fd, "payAmount", "المبلغ", { required: true });
  if (amount <= 0) throw new BusinessError("أدخل مبلغاً أكبر من صفر");
  await createPayment(prisma, {
    direction: "OUT",
    kind: "EXPENSE_PAYMENT",
    accountId: f.id(fd, "accountId", "الحساب"),
    amount,
    date: f.date(fd, "date", "التاريخ"),
    method: f.optText(fd, "method") ?? "CASH",
    reference: f.optText(fd, "reference"),
    allocations: [{ expenseId: id, amount }],
  });
  return { message: "تم تسجيل السداد" };
});

export const voidExpenseAction = ownerAction(async (fd) => {
  await voidExpense(prisma, f.id(fd, "id", "المصروف"), f.text(fd, "reason", "السبب"));
  return { message: "تم إلغاء المصروف" };
});

// ----- المصروفات الدورية -----
export const createRecurringAction = ownerAction(async (fd) => {
  const r = await prisma.recurringExpense.create({
    data: {
      name: f.text(fd, "name", "الاسم"),
      categoryId: f.id(fd, "categoryId", "الفئة"),
      amount: f.money(fd, "amount", "المبلغ", { required: true }),
      dayOfMonth: f.int(fd, "dayOfMonth", "يوم الشهر", 1, 31),
      notes: f.optText(fd, "notes"),
    },
  });
  await audit(prisma, "RECURRING_CREATED", "RecurringExpense", r.id);
  return { message: "تمت إضافة المصروف الدوري" };
});

export const toggleRecurringAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "المصروف الدوري");
  const r = await prisma.recurringExpense.findUniqueOrThrow({ where: { id } });
  await prisma.recurringExpense.update({ where: { id }, data: { active: !r.active } });
  return { message: r.active ? "تم الإيقاف" : "تم التفعيل" };
});

/** تسجيل المصروف الدوري لشهر معيّن — مرة واحدة فقط لكل شهر. */
export const recordRecurringAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "المصروف الدوري");
  const period = f.text(fd, "period", "الشهر", 7);
  if (!isPeriod(period)) throw new BusinessError("صيغة الشهر غير صحيحة");
  const r = await prisma.recurringExpense.findUniqueOrThrow({ where: { id } });
  const payNow = f.bool(fd, "payNow");
  await createExpense(prisma, {
    date: dayOfPeriod(period, r.dayOfMonth),
    categoryId: r.categoryId,
    description: `${r.name} — ${period}`,
    amount: f.money(fd, "amount", "المبلغ") || r.amount,
    recurringExpenseId: r.id,
    period,
    payNow: payNow ? { accountId: f.id(fd, "accountId", "الحساب"), method: f.optText(fd, "method") ?? "CASH" } : null,
  });
  return { message: "تم تسجيل المصروف لهذا الشهر" };
});

// ----- الإيرادات الأخرى -----
export const createIncomeAction = ownerAction(async (fd) => {
  const receiveNow = f.bool(fd, "receiveNow");
  await createOtherIncome(prisma, {
    date: f.date(fd, "date", "التاريخ"),
    categoryId: f.optId(fd, "categoryId"),
    description: f.text(fd, "description", "الوصف"),
    amount: f.money(fd, "amount", "المبلغ", { required: true }),
    notes: f.optText(fd, "notes"),
    receiveNow: receiveNow ? { accountId: f.id(fd, "accountId", "الحساب"), method: f.optText(fd, "method") ?? "CASH", reference: f.optText(fd, "reference") } : null,
  });
  return { message: "تم تسجيل الإيراد" };
});

export const receiveIncomeAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الإيراد");
  const amount = f.money(fd, "payAmount", "المبلغ", { required: true });
  if (amount <= 0) throw new BusinessError("أدخل مبلغاً أكبر من صفر");
  await createPayment(prisma, {
    direction: "IN",
    kind: "OTHER_INCOME",
    accountId: f.id(fd, "accountId", "الحساب"),
    amount,
    date: f.date(fd, "date", "التاريخ"),
    method: f.optText(fd, "method") ?? "CASH",
    allocations: [{ otherIncomeId: id, amount }],
  });
  return { message: "تم تسجيل التحصيل" };
});

export const voidIncomeAction = ownerAction(async (fd) => {
  await voidOtherIncome(prisma, f.id(fd, "id", "الإيراد"), f.text(fd, "reason", "السبب"));
  return { message: "تم إلغاء الإيراد" };
});
