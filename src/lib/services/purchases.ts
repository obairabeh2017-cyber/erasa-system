import type { PrismaClient } from "@prisma/client";
import { BusinessError, assert } from "../errors";
import { distribute, lineAmount, sum } from "../money";
import { atomic } from "../tx";
import { nextNumber } from "../sequence";
import { audit } from "../audit";
import { postMovement } from "./inventory";
import { createPaymentTx } from "./payments";

export type PurchaseLineInput = { itemId: number; qty: number; unitCost: number; lineDiscount: number };
export type PurchaseDraftInput = {
  supplierId: number;
  supplierInvoiceNo?: string | null;
  date: Date;
  dueDate?: Date | null;
  discount: number;
  notes?: string | null;
  lines: PurchaseLineInput[];
};
export type ImmediatePayment = { accountId: number; amount: number; method?: string; reference?: string | null; date?: Date };

export function computePurchaseTotals(lines: PurchaseLineInput[], discount: number) {
  const computed = lines.map((l) => {
    const gross = lineAmount(l.qty, l.unitCost);
    return { ...l, gross, lineTotal: gross - l.lineDiscount };
  });
  const subtotal = sum(computed.map((l) => l.gross));
  const linesNet = sum(computed.map((l) => l.lineTotal));
  return { lines: computed, subtotal, total: linesNet - discount };
}

function validateDraft(input: PurchaseDraftInput) {
  assert(input.lines.length > 0, "أضف صنفاً واحداً على الأقل إلى الفاتورة");
  for (const l of input.lines) {
    assert(l.qty > 0, "الكمية يجب أن تكون أكبر من صفر");
    assert(l.unitCost >= 0, "تكلفة الوحدة لا يمكن أن تكون سالبة");
    assert(l.lineDiscount >= 0, "الخصم لا يمكن أن يكون سالباً");
    assert(l.lineDiscount <= lineAmount(l.qty, l.unitCost), "خصم السطر أكبر من قيمته");
  }
  assert(input.discount >= 0, "الخصم لا يمكن أن يكون سالباً");
  const t = computePurchaseTotals(input.lines, input.discount);
  assert(t.total >= 0, "الخصم أكبر من إجمالي الفاتورة");
  return t;
}

/** حفظ مسودة شراء (إنشاء أو تعديل). المسودة لا تؤثر على المخزون ولا على الديون. */
export async function savePurchaseDraft(db: PrismaClient, input: PurchaseDraftInput, id?: number) {
  const t = validateDraft(input);
  return atomic(db, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    assert(supplier, "المورّد غير موجود");
    const items = await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } });
    assert(items.length === new Set(input.lines.map((l) => l.itemId)).size, "صنف غير موجود في الفاتورة");
    const data = {
      supplierId: input.supplierId,
      supplierInvoiceNo: input.supplierInvoiceNo || null,
      date: input.date,
      dueDate: input.dueDate ?? null,
      discount: input.discount,
      subtotal: t.subtotal,
      total: t.total,
      notes: input.notes ?? null,
    };
    const lineData = t.lines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty,
      unitCost: l.unitCost,
      lineDiscount: l.lineDiscount,
      lineTotal: l.lineTotal,
    }));
    if (id) {
      const existing = await tx.purchase.findUnique({ where: { id } });
      assert(existing, "الفاتورة غير موجودة");
      assert(existing.status === "DRAFT", "لا يمكن تعديل فاتورة مُرحّلة أو ملغاة");
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      return tx.purchase.update({ where: { id }, data: { ...data, items: { create: lineData } } });
    }
    const number = await nextNumber(tx, "PUR");
    return tx.purchase.create({ data: { ...data, number, items: { create: lineData } } });
  });
}

/**
 * ترحيل فاتورة الشراء: يزيد المخزون بتكلفة الشراء (بعد توزيع خصم الفاتورة)
 * ويسجّل الدين للمورّد، ويُسجّل الدفعة الفورية إن وُجدت — كله في معاملة واحدة.
 */
export async function postPurchase(db: PrismaClient, id: number, payment?: ImmediatePayment | null) {
  return atomic(db, async (tx) => {
    const guard = await tx.purchase.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", postedAt: new Date() },
    });
    if (guard.count !== 1) throw new BusinessError("الفاتورة مُرحّلة أو ملغاة بالفعل ولا يمكن ترحيلها مرة أخرى");
    const p = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: true } });
    assert(p.items.length > 0, "لا يمكن ترحيل فاتورة بدون أصناف");

    const values = distribute(
      p.total,
      p.items.map((l) => l.lineTotal),
    );
    for (let i = 0; i < p.items.length; i++) {
      const line = p.items[i];
      await tx.purchaseItem.update({ where: { id: line.id }, data: { stockValue: values[i] } });
      await postMovement(tx, {
        itemId: line.itemId,
        type: "PURCHASE",
        qtyDelta: line.qty,
        valueDelta: values[i],
        date: p.date,
        sourceType: "PURCHASE",
        sourceId: p.id,
        uniqueKey: `PUR:${p.id}:LINE:${line.id}`,
        notes: p.number,
      });
    }
    if (payment && payment.amount > 0) {
      assert(payment.amount <= p.total, "المبلغ المدفوع أكبر من إجمالي الفاتورة");
      await createPaymentTx(tx, {
        direction: "OUT",
        kind: "PURCHASE_PAYMENT",
        accountId: payment.accountId,
        amount: payment.amount,
        date: payment.date ?? p.date,
        method: payment.method,
        reference: payment.reference,
        supplierId: p.supplierId,
        allocations: [{ purchaseId: p.id, amount: payment.amount }],
      });
    }
    await audit(tx, "PURCHASE_POSTED", "Purchase", p.id, { number: p.number, total: p.total });
    return p;
  });
}

/** إلغاء فاتورة مُرحّلة بحركات عكسية؛ يتطلب عدم وجود مدفوعات قائمة وبقاء الكمية في المخزون. */
export async function voidPurchase(db: PrismaClient, id: number, reason: string) {
  assert(reason.trim(), "سبب الإلغاء مطلوب");
  return atomic(db, async (tx) => {
    const guard = await tx.purchase.updateMany({
      where: { id, status: "POSTED" },
      data: { status: "VOIDED", voidedAt: new Date() },
    });
    if (guard.count !== 1) throw new BusinessError("يمكن إلغاء الفواتير المُرحّلة فقط");
    const paid = await tx.paymentAllocation.count({ where: { purchaseId: id, payment: { status: "POSTED" } } });
    assert(paid === 0, "توجد مدفوعات على هذه الفاتورة؛ ألغِ الدفعات أو فك تخصيصها أولاً");
    const p = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: true } });
    for (const line of p.items) {
      await postMovement(tx, {
        itemId: line.itemId,
        type: "PURCHASE_VOID",
        qtyDelta: -line.qty,
        valueDelta: -line.stockValue,
        date: new Date(),
        sourceType: "PURCHASE",
        sourceId: p.id,
        uniqueKey: `PUR:${p.id}:LINE:${line.id}:VOID`,
        notes: `إلغاء ${p.number}: ${reason}`,
      });
    }
    await audit(tx, "PURCHASE_VOIDED", "Purchase", p.id, { reason });
  });
}

export async function deletePurchaseDraft(db: PrismaClient, id: number) {
  return atomic(db, async (tx) => {
    const p = await tx.purchase.findUnique({ where: { id } });
    assert(p && p.status === "DRAFT", "يمكن حذف المسودات فقط");
    await tx.purchase.delete({ where: { id } });
    await audit(tx, "PURCHASE_DRAFT_DELETED", "Purchase", id, { number: p.number });
  });
}
