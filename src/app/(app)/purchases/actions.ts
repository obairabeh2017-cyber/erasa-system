"use server";

import { prisma } from "@/lib/db";
import { ownerAction, toArabicError } from "@/lib/actions";
import * as f from "@/lib/form";
import { deletePurchaseDraft, postPurchase, savePurchaseDraft, voidPurchase } from "@/lib/services/purchases";
import { createPayment } from "@/lib/services/payments";
import { BusinessError } from "@/lib/errors";

function draftInput(fd: FormData) {
  const lines = f.jsonField(fd, "lines", f.priceLinesSchema);
  return {
    supplierId: f.id(fd, "partyId", "المورّد"),
    supplierInvoiceNo: f.optText(fd, "supplierInvoiceNo", 60),
    date: f.date(fd, "date", "تاريخ الفاتورة"),
    dueDate: f.optDate(fd, "dueDate"),
    discount: f.money(fd, "discount", "خصم الفاتورة"),
    notes: f.optText(fd, "notes"),
    lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.price, lineDiscount: l.discount ?? 0 })),
  };
}

export const savePurchaseAction = ownerAction(async (fd) => {
  const id = f.optId(fd, "id") ?? undefined;
  const post = fd.get("intent") === "post";
  const pay = post ? immediatePayment(fd) : null;
  const p = await savePurchaseDraft(prisma, draftInput(fd), id);
  if (post) {
    try {
      await postPurchase(prisma, p.id, pay);
    } catch (e) {
      // المسودة محفوظة؛ نعرض سبب تعذر الترحيل في صفحتها
      return `/purchases/${p.id}?postError=${encodeURIComponent(toArabicError(e))}`;
    }
  }
  return `/purchases/${p.id}`;
});

function immediatePayment(fd: FormData) {
  const amount = f.money(fd, "payAmount", "المبلغ المدفوع");
  if (amount <= 0) return null;
  return { accountId: f.id(fd, "accountId", "الحساب"), amount, method: f.optText(fd, "method") ?? "CASH", reference: f.optText(fd, "reference") };
}

export const postPurchaseAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الفاتورة");
  await postPurchase(prisma, id, immediatePayment(fd));
  return { message: "تم ترحيل الفاتورة: زاد المخزون وسُجّل دين المورّد" };
});

export const payPurchaseAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الفاتورة");
  const p = await prisma.purchase.findUniqueOrThrow({ where: { id } });
  const amount = f.money(fd, "payAmount", "المبلغ", { required: true });
  if (amount <= 0) throw new BusinessError("أدخل مبلغاً أكبر من صفر");
  await createPayment(prisma, {
    direction: "OUT",
    kind: "PURCHASE_PAYMENT",
    accountId: f.id(fd, "accountId", "الحساب"),
    amount,
    date: f.date(fd, "date", "التاريخ"),
    method: f.optText(fd, "method") ?? "CASH",
    reference: f.optText(fd, "reference"),
    supplierId: p.supplierId,
    allocations: [{ purchaseId: id, amount }],
  });
  return { message: "تم تسجيل الدفعة" };
});

export const voidPurchaseAction = ownerAction(async (fd) => {
  await voidPurchase(prisma, f.id(fd, "id", "الفاتورة"), f.text(fd, "reason", "السبب"));
  return { message: "تم إلغاء الفاتورة بحركات عكسية" };
});

export const deletePurchaseDraftAction = ownerAction(async (fd) => {
  await deletePurchaseDraft(prisma, f.id(fd, "id", "الفاتورة"));
  return "/purchases";
});
