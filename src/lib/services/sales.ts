import type { PrismaClient } from "@prisma/client";
import { BusinessError, assert } from "../errors";
import { distribute, formatQty, lineAmount, mulDiv, sum } from "../money";
import { atomic } from "../tx";
import { nextNumber } from "../sequence";
import { audit } from "../audit";
import { postMovement } from "./inventory";
import { createPaymentTx, saleOutstanding } from "./payments";

export type SaleLineInput = { itemId: number; qty: number; unitPrice: number; lineDiscount: number };
export type SaleDraftInput = {
  customerId?: number | null;
  date: Date;
  dueDate?: Date | null;
  discount: number;
  notes?: string | null;
  lines: SaleLineInput[];
};
export type ImmediateReceipt = { accountId: number; amount: number; method?: string; reference?: string | null; date?: Date };

export function computeSaleTotals(lines: SaleLineInput[], discount: number) {
  const computed = lines.map((l) => {
    const gross = lineAmount(l.qty, l.unitPrice);
    return { ...l, gross, lineTotal: gross - l.lineDiscount };
  });
  const subtotal = sum(computed.map((l) => l.gross));
  const linesNet = sum(computed.map((l) => l.lineTotal));
  return { lines: computed, subtotal, total: linesNet - discount };
}

export async function saveSaleDraft(db: PrismaClient, input: SaleDraftInput, id?: number) {
  assert(input.lines.length > 0, "أضف منتجاً واحداً على الأقل إلى الفاتورة");
  for (const l of input.lines) {
    assert(l.qty > 0, "الكمية يجب أن تكون أكبر من صفر");
    assert(l.unitPrice >= 0, "سعر البيع لا يمكن أن يكون سالباً");
    assert(l.lineDiscount >= 0 && l.lineDiscount <= lineAmount(l.qty, l.unitPrice), "خصم السطر غير صالح");
  }
  assert(input.discount >= 0, "الخصم لا يمكن أن يكون سالباً");
  const t = computeSaleTotals(input.lines, input.discount);
  assert(t.total >= 0, "الخصم أكبر من إجمالي الفاتورة");

  return atomic(db, async (tx) => {
    if (input.customerId) {
      const c = await tx.customer.findUnique({ where: { id: input.customerId } });
      assert(c, "الزبون غير موجود");
    }
    const items = await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } });
    assert(items.every((i) => i.type === "FINISHED"), "فواتير البيع للمنتجات التامة فقط");
    assert(items.length === new Set(input.lines.map((l) => l.itemId)).size, "منتج غير موجود في الفاتورة");
    const data = {
      customerId: input.customerId ?? null,
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
      unitPrice: l.unitPrice,
      lineDiscount: l.lineDiscount,
      lineTotal: l.lineTotal,
    }));
    if (id) {
      const existing = await tx.sale.findUnique({ where: { id } });
      assert(existing, "الفاتورة غير موجودة");
      assert(existing.status === "DRAFT", "لا يمكن تعديل فاتورة مُرحّلة أو ملغاة");
      await tx.saleItem.deleteMany({ where: { saleId: id } });
      return tx.sale.update({ where: { id }, data: { ...data, items: { create: lineData } } });
    }
    const number = await nextNumber(tx, "INV");
    return tx.sale.create({ data: { ...data, number, items: { create: lineData } } });
  });
}

/**
 * ترحيل فاتورة البيع: يخصم المنتجات من المخزون مرة واحدة، ويحفظ لقطة تكلفة المواد
 * لكل سطر (فلا يتغير الربح التاريخي لاحقاً)، ويسجّل دين الزبون والتحصيل الفوري.
 */
export async function postSale(db: PrismaClient, id: number, receipt?: ImmediateReceipt | null) {
  return atomic(db, async (tx) => {
    const guard = await tx.sale.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", postedAt: new Date() },
    });
    if (guard.count !== 1) throw new BusinessError("الفاتورة مُرحّلة أو ملغاة بالفعل ولا يمكن ترحيلها مرة أخرى");
    const sale = await tx.sale.findUniqueOrThrow({ where: { id }, include: { items: { include: { item: true } } } });
    assert(sale.items.length > 0, "لا يمكن ترحيل فاتورة بدون أصناف");
    const paid = receipt?.amount ?? 0;
    assert(paid >= 0 && paid <= sale.total, "المبلغ المستلم أكبر من إجمالي الفاتورة");
    if (paid < sale.total) {
      assert(sale.customerId, "البيع الآجل (غير المدفوع بالكامل) يتطلب تحديد الزبون");
    }
    for (const line of sale.items) {
      assert(line.item.active, `المنتج «${line.item.name}» غير نشط`);
    }

    const nets = distribute(sale.total, sale.items.map((l) => l.lineTotal));
    let costTotal = 0;
    for (let i = 0; i < sale.items.length; i++) {
      const line = sale.items[i];
      const r = await postMovement(tx, {
        itemId: line.itemId,
        type: "SALE",
        qtyDelta: -line.qty,
        date: sale.date,
        sourceType: "SALE",
        sourceId: sale.id,
        uniqueKey: `SALE:${sale.id}:LINE:${line.id}`,
        notes: sale.number,
      });
      const cost = -r.valueDelta;
      costTotal += cost;
      await tx.saleItem.update({
        where: { id: line.id },
        data: { netAmount: nets[i], costTotal: cost, unitCost: r.unitCost },
      });
    }
    await tx.sale.update({ where: { id }, data: { costTotal } });

    if (paid > 0 && receipt) {
      await createPaymentTx(tx, {
        direction: "IN",
        kind: "SALE_RECEIPT",
        accountId: receipt.accountId,
        amount: paid,
        date: receipt.date ?? sale.date,
        method: receipt.method,
        reference: receipt.reference,
        customerId: sale.customerId,
        allocations: [{ saleId: sale.id, amount: paid }],
      });
    }
    await audit(tx, "SALE_POSTED", "Sale", sale.id, { number: sale.number, total: sale.total, costTotal });
    return { ...sale, costTotal };
  });
}

/** إلغاء فاتورة مُرحّلة: يعيد المنتجات للمخزون بتكلفتها المسجّلة. */
export async function voidSale(db: PrismaClient, id: number, reason: string) {
  assert(reason.trim(), "سبب الإلغاء مطلوب");
  return atomic(db, async (tx) => {
    const guard = await tx.sale.updateMany({
      where: { id, status: "POSTED" },
      data: { status: "VOIDED", voidedAt: new Date() },
    });
    if (guard.count !== 1) throw new BusinessError("يمكن إلغاء الفواتير المُرحّلة فقط");
    const paid = await tx.paymentAllocation.count({ where: { saleId: id, payment: { status: "POSTED" } } });
    assert(paid === 0, "توجد مدفوعات على هذه الفاتورة؛ ألغِ الدفعات أو فك تخصيصها أولاً");
    const returns = await tx.saleReturn.count({ where: { saleId: id, status: "POSTED" } });
    assert(returns === 0, "توجد مرتجعات على هذه الفاتورة؛ لا يمكن إلغاؤها");
    const sale = await tx.sale.findUniqueOrThrow({ where: { id }, include: { items: true } });
    for (const line of sale.items) {
      await postMovement(tx, {
        itemId: line.itemId,
        type: "SALE_VOID",
        qtyDelta: line.qty,
        valueDelta: line.costTotal,
        date: new Date(),
        sourceType: "SALE",
        sourceId: sale.id,
        uniqueKey: `SALE:${sale.id}:LINE:${line.id}:VOID`,
        notes: `إلغاء ${sale.number}: ${reason}`,
      });
    }
    await audit(tx, "SALE_VOIDED", "Sale", sale.id, { reason });
  });
}

export async function deleteSaleDraft(db: PrismaClient, id: number) {
  return atomic(db, async (tx) => {
    const s = await tx.sale.findUnique({ where: { id } });
    assert(s && s.status === "DRAFT", "يمكن حذف المسودات فقط");
    await tx.sale.delete({ where: { id } });
    await audit(tx, "SALE_DRAFT_DELETED", "Sale", id, { number: s.number });
  });
}

/** الكميات المتاحة للإرجاع لكل سطر. */
export async function returnableQuantities(db: PrismaClient, saleId: number) {
  const sale = await db.sale.findUniqueOrThrow({
    where: { id: saleId },
    include: { items: { include: { item: true, returnItems: { include: { saleReturn: true } } } } },
  });
  return sale.items.map((l) => {
    const returned = sum(l.returnItems.filter((r) => r.saleReturn.status === "POSTED").map((r) => r.qty));
    return { line: l, returned, returnable: l.qty - returned };
  });
}

/**
 * مرتجع مبيعات (إشعار دائن): يعيد المنتج للمخزون بتكلفته الأصلية، ويخفّض رصيد الفاتورة.
 * إن أصبح الزبون دافعاً أكثر من المستحق يمكن رد الفرق نقداً (refund).
 */
export async function createSaleReturn(
  db: PrismaClient,
  input: {
    saleId: number;
    date: Date;
    notes?: string | null;
    lines: { saleItemId: number; qty: number }[];
    refund?: { accountId: number; method?: string } | null;
  },
) {
  const lines = input.lines.filter((l) => l.qty > 0);
  assert(lines.length > 0, "حدد كمية مرتجعة لمنتج واحد على الأقل");
  return atomic(db, async (tx) => {
    // كتابة أولى لحجز قفل الكتابة قبل القراءة
    const touched = await tx.sale.updateMany({ where: { id: input.saleId, status: "POSTED" }, data: { updatedAt: new Date() } });
    if (touched.count !== 1) throw new BusinessError("المرتجع ممكن فقط لفاتورة مُرحّلة");
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: input.saleId },
      include: { items: { include: { item: true, returnItems: { include: { saleReturn: true } } } } },
    });
    const number = await nextNumber(tx, "RET");
    const ret = await tx.saleReturn.create({
      data: { number, saleId: sale.id, date: input.date, total: 0, costTotal: 0, notes: input.notes ?? null },
    });
    let total = 0;
    let costTotal = 0;
    for (const l of lines) {
      const si = sale.items.find((x) => x.id === l.saleItemId);
      assert(si, "سطر غير موجود في الفاتورة");
      const prior = si.returnItems.filter((r) => r.saleReturn.status === "POSTED");
      const returnedQty = sum(prior.map((r) => r.qty));
      const remaining = si.qty - returnedQty;
      assert(l.qty <= remaining, `الكمية المرتجعة من «${si.item.name}» أكبر من المتبقي (${formatQty(remaining)})`);
      const isLast = l.qty === remaining;
      const amount = isLast ? si.netAmount - sum(prior.map((r) => r.amount)) : mulDiv(si.netAmount, l.qty, si.qty);
      const costAmount = isLast ? si.costTotal - sum(prior.map((r) => r.costAmount)) : mulDiv(si.costTotal, l.qty, si.qty);
      await tx.saleReturnItem.create({ data: { returnId: ret.id, saleItemId: si.id, qty: l.qty, amount, costAmount } });
      await postMovement(tx, {
        itemId: si.itemId,
        type: "SALE_RETURN",
        qtyDelta: l.qty,
        valueDelta: costAmount,
        date: input.date,
        sourceType: "SALE_RETURN",
        sourceId: ret.id,
        uniqueKey: `RET:${ret.id}:LINE:${si.id}`,
        notes: `${number} / ${sale.number}`,
      });
      total += amount;
      costTotal += costAmount;
    }
    await tx.saleReturn.update({ where: { id: ret.id }, data: { total, costTotal } });

    const outstanding = await saleOutstanding(tx, sale.id);
    if (outstanding < 0 && input.refund) {
      await createPaymentTx(tx, {
        direction: "OUT",
        kind: "SALE_REFUND",
        accountId: input.refund.accountId,
        amount: -outstanding,
        date: input.date,
        method: input.refund.method,
        customerId: sale.customerId,
        notes: `رد مبلغ مرتجع ${number}`,
        allocations: [{ saleId: sale.id, amount: -outstanding }],
      });
    }
    await audit(tx, "SALE_RETURN_POSTED", "SaleReturn", ret.id, { saleId: sale.id, total, costTotal });
    return { ...ret, total, costTotal };
  });
}
