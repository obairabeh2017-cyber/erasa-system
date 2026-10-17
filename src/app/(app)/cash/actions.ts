"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { audit } from "@/lib/audit";
import { transferBetweenAccounts } from "@/lib/services/payments";
import { BusinessError } from "@/lib/errors";

export const createAccountAction = ownerAction(async (fd) => {
  const a = await prisma.cashAccount.create({
    data: {
      name: f.text(fd, "name", "اسم الحساب"),
      type: f.oneOf(fd, "type", ["CASH", "BANK"] as const, "نوع الحساب"),
      openingBalance: f.money(fd, "openingBalance", "الرصيد الافتتاحي"),
      openingDate: f.date(fd, "openingDate", "تاريخ الرصيد الافتتاحي"),
      notes: f.optText(fd, "notes"),
    },
  });
  await audit(prisma, "ACCOUNT_CREATED", "CashAccount", a.id, { name: a.name, openingBalance: a.openingBalance });
  return { message: "تمت إضافة الحساب" };
});

export const updateAccountAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الحساب");
  const before = await prisma.cashAccount.findUniqueOrThrow({ where: { id } });
  const data = {
    name: f.text(fd, "name", "اسم الحساب"),
    openingBalance: f.money(fd, "openingBalance", "الرصيد الافتتاحي"),
    openingDate: f.date(fd, "openingDate", "تاريخ الرصيد الافتتاحي"),
    notes: f.optText(fd, "notes"),
    active: f.bool(fd, "active"),
  };
  await prisma.cashAccount.update({ where: { id }, data });
  // تعديل الرصيد الافتتاحي يُسجّل في سجل التدقيق مع القيمة السابقة
  await audit(prisma, "ACCOUNT_UPDATED", "CashAccount", id, { before: { openingBalance: before.openingBalance, name: before.name }, after: data });
  return { message: "تم حفظ الحساب" };
});

export const transferAction = ownerAction(async (fd) => {
  const amount = f.money(fd, "amount", "المبلغ", { required: true });
  if (amount <= 0) throw new BusinessError("أدخل مبلغاً أكبر من صفر");
  await transferBetweenAccounts(prisma, {
    fromAccountId: f.id(fd, "fromAccountId", "من حساب"),
    toAccountId: f.id(fd, "toAccountId", "إلى حساب"),
    amount,
    date: f.date(fd, "date", "التاريخ"),
    reference: f.optText(fd, "reference"),
    notes: f.optText(fd, "notes"),
  });
  return { message: "تم التحويل" };
});
