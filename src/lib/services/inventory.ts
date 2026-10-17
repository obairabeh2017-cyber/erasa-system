import type { PrismaClient } from "@prisma/client";
import { BusinessError, assert } from "../errors";
import { formatQty, mulDiv, unitCostOf } from "../money";
import { atomic, type Tx } from "../tx";
import { audit } from "../audit";

export type MovementInput = {
  itemId: number;
  type: string;
  qtyDelta: number;
  /** للحركات الواردة: القيمة إلزامية. للصادرة: تُحسب بمتوسط التكلفة إن لم تُحدَّد. */
  valueDelta?: number;
  date: Date;
  sourceType: string;
  sourceId?: number | null;
  uniqueKey?: string | null;
  notes?: string | null;
};

export type MovementResult = { movementId: number; qtyDelta: number; valueDelta: number; unitCost: number };

/**
 * يسجّل حركة مخزون ويحدّث الرصيد المشتق ذرّياً داخل المعاملة.
 * - لا يُسمح بالرصيد السالب: التحديث مشروط في قاعدة البيانات نفسها (WHERE stockQty >= الكمية)
 *   فلا يمكن لطلبين متزامنين تجاوز الرصيد.
 * - uniqueKey يمنع تسجيل الحركة نفسها مرتين.
 */
export async function postMovement(tx: Tx, m: MovementInput): Promise<MovementResult> {
  assert(m.qtyDelta !== 0, "كمية الحركة لا يمكن أن تكون صفراً");
  const item = await tx.item.findUnique({ where: { id: m.itemId } });
  if (!item) throw new BusinessError("الصنف غير موجود");

  let valueDelta: number;
  if (m.qtyDelta < 0) {
    const out = -m.qtyDelta;
    if (item.stockQty < out) {
      throw new BusinessError(
        `الرصيد غير كافٍ للصنف «${item.name}»: المتوفر ${formatQty(item.stockQty)} والمطلوب ${formatQty(out)}`,
      );
    }
    if (out === item.stockQty) {
      // إخراج كامل الرصيد يُخرج كامل القيمة (لا تبقى قيمة بلا كمية)
      valueDelta = -item.stockValue;
    } else if (m.valueDelta !== undefined) {
      valueDelta = Math.max(m.valueDelta, -item.stockValue);
    } else {
      valueDelta = -mulDiv(item.stockValue, out, item.stockQty);
    }
  } else {
    assert(m.valueDelta !== undefined && m.valueDelta >= 0, "قيمة الحركة الواردة غير صالحة");
    valueDelta = m.valueDelta;
  }

  // تحديث مشروط: يفشل إن تغيّر الرصيد بحيث يصبح سالباً
  const updated = await tx.item.updateMany({
    where: { id: m.itemId, stockQty: { gte: m.qtyDelta < 0 ? -m.qtyDelta : 0 } },
    data: { stockQty: { increment: m.qtyDelta }, stockValue: { increment: valueDelta } },
  });
  if (updated.count !== 1) {
    throw new BusinessError(`الرصيد غير كافٍ للصنف «${item.name}»`);
  }
  const after = await tx.item.findUniqueOrThrow({ where: { id: m.itemId } });
  if (after.stockQty < 0) throw new BusinessError(`الرصيد غير كافٍ للصنف «${item.name}»`);

  const mv = await tx.stockMovement.create({
    data: {
      itemId: m.itemId,
      type: m.type,
      qtyDelta: m.qtyDelta,
      valueDelta,
      balanceAfter: after.stockQty,
      date: m.date,
      sourceType: m.sourceType,
      sourceId: m.sourceId ?? null,
      uniqueKey: m.uniqueKey ?? null,
      notes: m.notes ?? null,
    },
  });
  return {
    movementId: mv.id,
    qtyDelta: m.qtyDelta,
    valueDelta,
    unitCost: unitCostOf(Math.abs(valueDelta), Math.abs(m.qtyDelta)),
  };
}

/** متوسط تكلفة الوحدة الحالي (درهم لكل وحدة). */
export function averageCost(item: { stockQty: number; stockValue: number }): number {
  return item.stockQty > 0 ? unitCostOf(item.stockValue, item.stockQty) : 0;
}

/** رصيد افتتاحي: مرة واحدة فقط لكل صنف. */
export async function recordOpeningBalance(
  db: PrismaClient,
  input: { itemId: number; qty: number; unitCost: number; date: Date; notes?: string | null },
) {
  assert(input.qty > 0, "الكمية الافتتاحية يجب أن تكون أكبر من صفر");
  assert(input.unitCost >= 0, "تكلفة الوحدة غير صالحة");
  return atomic(db, async (tx) => {
    const existing = await tx.stockMovement.findFirst({ where: { itemId: input.itemId, type: "OPENING" } });
    if (existing) throw new BusinessError("تم تسجيل رصيد افتتاحي لهذا الصنف مسبقاً؛ استخدم التسوية للتعديل");
    const r = await postMovement(tx, {
      itemId: input.itemId,
      type: "OPENING",
      qtyDelta: input.qty,
      valueDelta: mulDiv(input.qty, input.unitCost, 1000),
      date: input.date,
      sourceType: "OPENING",
      uniqueKey: `OPENING:${input.itemId}`,
      notes: input.notes,
    });
    await audit(tx, "OPENING_BALANCE", "Item", input.itemId, { qty: input.qty, unitCost: input.unitCost });
    return r;
  });
}

/** تسوية مخزون مُدققة (زيادة أو نقص) — لا تُستبدل الكمية أبداً، بل تُسجّل حركة فرق. */
export async function recordAdjustment(
  db: PrismaClient,
  input: { itemId: number; qtyDelta: number; unitCost?: number | null; date: Date; reason: string },
) {
  assert(input.qtyDelta !== 0, "كمية التسوية لا يمكن أن تكون صفراً");
  assert(input.reason.trim().length > 0, "سبب التسوية مطلوب");
  return atomic(db, async (tx) => {
    const item = await tx.item.findUniqueOrThrow({ where: { id: input.itemId } });
    let valueDelta: number | undefined;
    if (input.qtyDelta > 0) {
      const uc = input.unitCost ?? averageCost(item);
      valueDelta = mulDiv(input.qtyDelta, uc, 1000);
    }
    const r = await postMovement(tx, {
      itemId: input.itemId,
      type: "ADJUSTMENT",
      qtyDelta: input.qtyDelta,
      valueDelta,
      date: input.date,
      sourceType: "ADJUSTMENT",
      notes: input.reason,
    });
    await audit(tx, "STOCK_ADJUSTMENT", "Item", input.itemId, { qtyDelta: input.qtyDelta, reason: input.reason });
    return r;
  });
}

/** الرصيد كما هو محسوب من الحركات (المصدر الحقيقي). */
export async function balanceFromMovements(db: PrismaClient | Tx, itemId: number, before?: Date) {
  const agg = await db.stockMovement.aggregate({
    where: { itemId, ...(before ? { date: { lt: before } } : {}) },
    _sum: { qtyDelta: true, valueDelta: true },
  });
  return { qty: agg._sum.qtyDelta ?? 0, value: agg._sum.valueDelta ?? 0 };
}

/** فحص سلامة: يقارن الرصيد المخزّن بمجموع الحركات لكل صنف. */
export async function checkStockIntegrity(db: PrismaClient) {
  const items = await db.item.findMany({ select: { id: true, sku: true, name: true, stockQty: true, stockValue: true } });
  const sums = await db.stockMovement.groupBy({ by: ["itemId"], _sum: { qtyDelta: true, valueDelta: true } });
  const map = new Map(sums.map((s) => [s.itemId, s._sum]));
  const mismatches = [];
  for (const it of items) {
    const s = map.get(it.id);
    const q = s?.qtyDelta ?? 0;
    const v = s?.valueDelta ?? 0;
    if (q !== it.stockQty || v !== it.stockValue || it.stockQty < 0) {
      mismatches.push({ ...it, movementQty: q, movementValue: v });
    }
  }
  return { checked: items.length, mismatches };
}

/** أرصدة كل الأصناف حتى تاريخ معيّن، محسوبة من الحركات. */
export async function stockAsOf(db: PrismaClient, before: Date) {
  const sums = await db.stockMovement.groupBy({
    by: ["itemId"],
    where: { date: { lt: before } },
    _sum: { qtyDelta: true, valueDelta: true },
  });
  return new Map(sums.map((s) => [s.itemId, { qty: s._sum.qtyDelta ?? 0, value: s._sum.valueDelta ?? 0 }]));
}
