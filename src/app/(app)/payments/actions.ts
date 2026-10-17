"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { allocatePayment, removeAllocation, voidPayment, type AllocationInput } from "@/lib/services/payments";
import { BusinessError } from "@/lib/errors";

const KEY = /^alloc_(sale|purchase|expense|otherIncome)_(\d+)$/;

export const allocateAction = ownerAction(async (fd) => {
  const paymentId = f.id(fd, "id", "الدفعة");
  const allocations: AllocationInput[] = [];
  for (const key of fd.keys()) {
    const m = KEY.exec(key);
    if (!m) continue;
    const amount = f.money(fd, key, "مبلغ التخصيص");
    if (amount <= 0) continue;
    const docId = Number(m[2]);
    if (m[1] === "sale") allocations.push({ saleId: docId, amount });
    else if (m[1] === "purchase") allocations.push({ purchaseId: docId, amount });
    else if (m[1] === "expense") allocations.push({ expenseId: docId, amount });
    else allocations.push({ otherIncomeId: docId, amount });
  }
  if (allocations.length === 0) throw new BusinessError("أدخل مبلغ تخصيص لمستند واحد على الأقل");
  await allocatePayment(prisma, paymentId, allocations);
  return { message: "تم التخصيص" };
});

export const removeAllocationAction = ownerAction(async (fd) => {
  await removeAllocation(prisma, f.id(fd, "allocationId", "التخصيص"));
  return { message: "تم فك التخصيص؛ أصبح المبلغ غير مخصص" };
});

export const voidPaymentAction = ownerAction(async (fd) => {
  await voidPayment(prisma, f.id(fd, "id", "الدفعة"), f.text(fd, "reason", "السبب"));
  return { message: "تم إلغاء الدفعة" };
});
