"use server";

import { prisma } from "@/lib/db";
import { ownerAction, toArabicError } from "@/lib/actions";
import * as f from "@/lib/form";
import { createSaleReturn, deleteSaleDraft, postSale, saveSaleDraft, voidSale } from "@/lib/services/sales";
import { createPayment, saleOutstanding } from "@/lib/services/payments";
import { BusinessError } from "@/lib/errors";

function draftInput(fd: FormData) {
  const lines = f.jsonField(fd, "lines", f.priceLinesSchema);
  return {
    customerId: f.optId(fd, "partyId"),
    date: f.date(fd, "date", "تاريخ الفاتورة"),
    dueDate: f.optDate(fd, "dueDate"),
    discount: f.money(fd, "discount", "خصم الفاتورة"),
    notes: f.optText(fd, "notes"),
    lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.price, lineDiscount: l.discount ?? 0 })),
  };
}

function receipt(fd: FormData) {
  const amount = f.money(fd, "payAmount", "المبلغ المستلم");
  if (amount <= 0) return null;
  return { accountId: f.id(fd, "accountId", "الحساب"), amount, method: f.optText(fd, "method") ?? "CASH", reference: f.optText(fd, "reference") };
}

export const saveSaleAction = ownerAction(async (fd) => {
  const id = f.optId(fd, "id") ?? undefined;
  const post = fd.get("intent") === "post";
  const r = post ? receipt(fd) : null;
  const s = await saveSaleDraft(prisma, draftInput(fd), id);
  if (post) {
    try {
      await postSale(prisma, s.id, r);
    } catch (e) {
      return `/sales/${s.id}?postError=${encodeURIComponent(toArabicError(e))}`;
    }
  }
  return `/sales/${s.id}`;
});

export const postSaleAction = ownerAction(async (fd) => {
  await postSale(prisma, f.id(fd, "id", "الفاتورة"), receipt(fd));
  return { message: "تم ترحيل الفاتورة: خُصمت المنتجات من المخزون" };
});

export const receiveSaleAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الفاتورة");
  const s = await prisma.sale.findUniqueOrThrow({ where: { id } });
  const amount = f.money(fd, "payAmount", "المبلغ", { required: true });
  if (amount <= 0) throw new BusinessError("أدخل مبلغاً أكبر من صفر");
  await createPayment(prisma, {
    direction: "IN",
    kind: "SALE_RECEIPT",
    accountId: f.id(fd, "accountId", "الحساب"),
    amount,
    date: f.date(fd, "date", "التاريخ"),
    method: f.optText(fd, "method") ?? "CASH",
    reference: f.optText(fd, "reference"),
    customerId: s.customerId,
    allocations: [{ saleId: id, amount }],
  });
  return { message: "تم تسجيل المبلغ المستلم" };
});

export const refundSaleAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الفاتورة");
  const s = await prisma.sale.findUniqueOrThrow({ where: { id } });
  const out = await saleOutstanding(prisma, id);
  if (out >= 0) throw new BusinessError("لا يوجد مبلغ زائد لرده على هذه الفاتورة");
  await createPayment(prisma, {
    direction: "OUT",
    kind: "SALE_REFUND",
    accountId: f.id(fd, "accountId", "الحساب"),
    amount: -out,
    date: f.date(fd, "date", "التاريخ"),
    method: f.optText(fd, "method") ?? "CASH",
    reference: f.optText(fd, "reference"),
    customerId: s.customerId,
    allocations: [{ saleId: id, amount: -out }],
  });
  return { message: "تم تسجيل رد المبلغ" };
});

export const voidSaleAction = ownerAction(async (fd) => {
  await voidSale(prisma, f.id(fd, "id", "الفاتورة"), f.text(fd, "reason", "السبب"));
  return { message: "تم إلغاء الفاتورة وإعادة المنتجات للمخزون" };
});

export const deleteSaleDraftAction = ownerAction(async (fd) => {
  await deleteSaleDraft(prisma, f.id(fd, "id", "الفاتورة"));
  return "/sales";
});

export const saleReturnAction = ownerAction(async (fd) => {
  const saleId = f.id(fd, "id", "الفاتورة");
  const lines: { saleItemId: number; qty: number }[] = [];
  for (const key of fd.keys()) {
    const m = /^ret_(\d+)$/.exec(key);
    if (m) lines.push({ saleItemId: Number(m[1]), qty: f.qty(fd, key, "الكمية المرتجعة") });
  }
  const refund = f.bool(fd, "refund");
  await createSaleReturn(prisma, {
    saleId,
    date: f.date(fd, "date", "التاريخ"),
    notes: f.optText(fd, "notes"),
    lines,
    refund: refund ? { accountId: f.id(fd, "accountId", "الحساب"), method: f.optText(fd, "method") ?? "CASH" } : null,
  });
  return { message: "تم تسجيل المرتجع وإعادة المنتجات للمخزون" };
});
