import type { PrismaClient } from "@prisma/client";
import { BusinessError, assert } from "../errors";
import { mulDiv, unitCostOf } from "../money";
import { atomic, type Tx } from "../tx";
import { nextNumber } from "../sequence";
import { audit } from "../audit";
import { postMovement } from "./inventory";

export type RecipeLineInput = { materialId: number; qty: number; wasteBp: number };

/**
 * يحفظ وصفة جديدة كنسخة جديدة؛ النسخ السابقة تبقى كما هي لأن أوامر الإنتاج
 * تنسخ موادها عند الإنشاء، فلا يتغيّر التاريخ عند تعديل الوصفة.
 */
export async function saveRecipe(
  db: PrismaClient,
  input: { productId: number; outputQty: number; notes?: string | null; lines: RecipeLineInput[] },
) {
  assert(input.outputQty > 0, "كمية الإنتاج للوصفة يجب أن تكون أكبر من صفر");
  assert(input.lines.length > 0, "أضف مادة خام واحدة على الأقل إلى الوصفة");
  const ids = new Set<number>();
  for (const l of input.lines) {
    assert(l.qty > 0, "كمية كل مادة في الوصفة يجب أن تكون أكبر من صفر");
    assert(l.wasteBp >= 0 && l.wasteBp <= 10000, "نسبة الهدر يجب أن تكون بين 0 و100%");
    assert(!ids.has(l.materialId), "لا يمكن تكرار نفس المادة في الوصفة");
    ids.add(l.materialId);
  }
  return atomic(db, async (tx) => {
    const product = await tx.item.findUnique({ where: { id: input.productId } });
    assert(product && product.type === "FINISHED", "الوصفة تخص منتجاً تاماً فقط");
    const materials = await tx.item.findMany({ where: { id: { in: [...ids] } } });
    assert(materials.length === ids.size, "مادة غير موجودة في الوصفة");
    assert(materials.every((m) => m.type === "RAW"), "مكوّنات الوصفة يجب أن تكون مواد خام");

    const last = await tx.productRecipe.findFirst({
      where: { productId: input.productId },
      orderBy: { version: "desc" },
    });
    await tx.productRecipe.updateMany({ where: { productId: input.productId }, data: { isActive: false } });
    const recipe = await tx.productRecipe.create({
      data: {
        productId: input.productId,
        version: (last?.version ?? 0) + 1,
        isActive: true,
        outputQty: input.outputQty,
        notes: input.notes ?? null,
        lines: { create: input.lines.map((l) => ({ materialId: l.materialId, qty: l.qty, wasteBp: l.wasteBp })) },
      },
    });
    await audit(tx, "RECIPE_SAVED", "ProductRecipe", recipe.id, { productId: input.productId, version: recipe.version });
    return recipe;
  });
}

/** الكمية المطلوبة من مادة لإنتاج كمية معيّنة، شاملة الهدر. */
export function requiredQuantity(
  line: { qty: number; wasteBp: number },
  recipeOutputQty: number,
  plannedQty: number,
): number {
  const base = mulDiv(line.qty, plannedQty, recipeOutputQty);
  return mulDiv(base, 10000 + line.wasteBp, 10000);
}

export async function createProductionOrder(
  db: PrismaClient,
  input: { productId: number; plannedQty: number; date: Date; notes?: string | null },
) {
  assert(input.plannedQty > 0, "الكمية المخططة يجب أن تكون أكبر من صفر");
  return atomic(db, async (tx) => {
    const product = await tx.item.findUnique({ where: { id: input.productId } });
    assert(product && product.type === "FINISHED", "اختر منتجاً تاماً");
    const recipe = await tx.productRecipe.findFirst({
      where: { productId: input.productId, isActive: true },
      include: { lines: true },
      orderBy: { version: "desc" },
    });
    assert(recipe, "لا توجد وصفة (قائمة مواد) لهذا المنتج؛ أنشئ الوصفة أولاً");
    const number = await nextNumber(tx, "PRD");
    const order = await tx.productionOrder.create({
      data: {
        number,
        productId: input.productId,
        recipeId: recipe.id,
        plannedQty: input.plannedQty,
        completedQty: input.plannedQty,
        date: input.date,
        notes: input.notes ?? null,
        materials: {
          create: recipe.lines.map((l) => {
            const req = requiredQuantity(l, recipe.outputQty, input.plannedQty);
            return { materialId: l.materialId, requiredQty: req, actualQty: req };
          }),
        },
      },
    });
    await audit(tx, "PRODUCTION_CREATED", "ProductionOrder", order.id, { number });
    return order;
  });
}

/** تعديل مسودة أمر الإنتاج: الكميات الفعلية والمواد الإضافية. */
export async function updateProductionDraft(
  db: PrismaClient,
  orderId: number,
  input: {
    plannedQty: number;
    completedQty: number;
    date: Date;
    notes?: string | null;
    materials: { materialId: number; actualQty: number }[];
    recalculate?: boolean;
  },
) {
  assert(input.plannedQty > 0, "الكمية المخططة يجب أن تكون أكبر من صفر");
  assert(input.completedQty >= 0, "الكمية المنجزة غير صالحة");
  const seen = new Set<number>();
  for (const m of input.materials) {
    assert(m.actualQty >= 0, "الكمية الفعلية للمادة لا يمكن أن تكون سالبة");
    assert(!seen.has(m.materialId), "لا يمكن تكرار نفس المادة");
    seen.add(m.materialId);
  }
  return atomic(db, async (tx) => {
    const order = await tx.productionOrder.findUnique({
      where: { id: orderId },
      include: { materials: true, recipe: { include: { lines: true } } },
    });
    assert(order, "أمر الإنتاج غير موجود");
    assert(order.status === "DRAFT", "لا يمكن تعديل أمر إنتاج غير مسودة");
    const mats = await tx.item.findMany({ where: { id: { in: [...seen] } } });
    assert(mats.every((m) => m.type === "RAW"), "المواد المستهلكة يجب أن تكون مواد خام");

    const required = new Map<number, number>();
    if (order.recipe) {
      for (const l of order.recipe.lines) {
        required.set(l.materialId, requiredQuantity(l, order.recipe.outputQty, input.plannedQty));
      }
    }
    const existing = new Map(order.materials.map((m) => [m.materialId, m]));
    await tx.productionMaterial.deleteMany({ where: { orderId } });
    const lines = input.recalculate
      ? [...required.entries()].map(([materialId, req]) => ({ materialId, actualQty: req }))
      : input.materials;
    for (const m of lines) {
      await tx.productionMaterial.create({
        data: {
          orderId,
          materialId: m.materialId,
          requiredQty: required.get(m.materialId) ?? existing.get(m.materialId)?.requiredQty ?? 0,
          actualQty: m.actualQty,
        },
      });
    }
    await tx.productionOrder.update({
      where: { id: orderId },
      data: {
        plannedQty: input.plannedQty,
        completedQty: input.recalculate ? input.plannedQty : input.completedQty,
        date: input.date,
        notes: input.notes ?? null,
      },
    });
  });
}

/** فحص التوفر: المطلوب مقابل المتوفر لكل مادة. */
export async function checkAvailability(db: PrismaClient | Tx, orderId: number) {
  const order = await db.productionOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { materials: { include: { material: { include: { unit: true } } } } },
  });
  const lines = order.materials.map((m) => ({
    materialId: m.materialId,
    name: m.material.name,
    sku: m.material.sku,
    unit: m.material.unit.name,
    requiredQty: m.requiredQty,
    actualQty: m.actualQty,
    available: m.material.stockQty,
    shortage: Math.max(0, m.actualQty - m.material.stockQty),
  }));
  return { lines, ok: lines.every((l) => l.shortage === 0) };
}

/**
 * إكمال أمر الإنتاج — كل شيء في معاملة واحدة:
 *  1) تحويل الحالة من مسودة إلى مكتمل بشرط ذرّي (يمنع الإكمال مرتين)
 *  2) خصم المواد الفعلية من المخزون بمتوسط التكلفة (يفشل إن لم يكفِ الرصيد)
 *  3) إضافة المنتج التام بقيمة المواد المستهلكة
 *  4) حفظ تكلفة الدفعة وتكلفة الوحدة
 * أي فشل يُلغي كل التغييرات.
 */
export async function completeProductionOrder(db: PrismaClient, orderId: number, opts?: { date?: Date }) {
  return atomic(db, async (tx) => {
    const completedAt = opts?.date ?? new Date();
    const guard = await tx.productionOrder.updateMany({
      where: { id: orderId, status: "DRAFT" },
      data: { status: "COMPLETED", completedAt },
    });
    if (guard.count !== 1) throw new BusinessError("أمر الإنتاج مكتمل أو ملغى بالفعل ولا يمكن إكماله مرة أخرى");

    const order = await tx.productionOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { materials: true, product: true },
    });
    assert(order.completedQty > 0, "أدخل الكمية المنجزة فعلياً (أكبر من صفر)");
    const lines = order.materials.filter((m) => m.actualQty > 0);
    assert(lines.length > 0, "لا توجد مواد مستهلكة مسجّلة لهذا الأمر");

    let total = 0;
    for (const m of lines) {
      const r = await postMovement(tx, {
        itemId: m.materialId,
        type: "PRODUCTION_CONSUME",
        qtyDelta: -m.actualQty,
        date: order.date,
        sourceType: "PRODUCTION",
        sourceId: order.id,
        uniqueKey: `PRD:${order.id}:CONSUME:${m.materialId}`,
        notes: order.number,
      });
      const cost = -r.valueDelta;
      total += cost;
      await tx.productionMaterial.update({
        where: { id: m.id },
        data: { unitCost: unitCostOf(cost, m.actualQty), totalCost: cost },
      });
    }

    await postMovement(tx, {
      itemId: order.productId,
      type: "PRODUCTION_OUTPUT",
      qtyDelta: order.completedQty,
      valueDelta: total,
      date: order.date,
      sourceType: "PRODUCTION",
      sourceId: order.id,
      uniqueKey: `PRD:${order.id}:OUTPUT`,
      notes: order.number,
    });

    const updated = await tx.productionOrder.update({
      where: { id: orderId },
      data: { materialCost: total, unitCost: unitCostOf(total, order.completedQty) },
    });
    await audit(tx, "PRODUCTION_COMPLETED", "ProductionOrder", order.id, { materialCost: total });
    return updated;
  });
}

export async function cancelProductionOrder(db: PrismaClient, orderId: number) {
  return atomic(db, async (tx) => {
    const r = await tx.productionOrder.updateMany({
      where: { id: orderId, status: "DRAFT" },
      data: { status: "CANCELLED" },
    });
    if (r.count !== 1) throw new BusinessError("يمكن إلغاء أوامر الإنتاج المسودة فقط");
    await audit(tx, "PRODUCTION_CANCELLED", "ProductionOrder", orderId);
  });
}

/** عكس أمر إنتاج مكتمل بحركات عكسية مُدققة (يتطلب بقاء المنتج التام في المخزون). */
export async function reverseProductionOrder(db: PrismaClient, orderId: number, reason: string) {
  assert(reason.trim(), "سبب العكس مطلوب");
  return atomic(db, async (tx) => {
    const guard = await tx.productionOrder.updateMany({
      where: { id: orderId, status: "COMPLETED" },
      data: { status: "REVERSED" },
    });
    if (guard.count !== 1) throw new BusinessError("يمكن عكس أوامر الإنتاج المكتملة فقط");
    const order = await tx.productionOrder.findUniqueOrThrow({ where: { id: orderId }, include: { materials: true } });
    const date = new Date();
    await postMovement(tx, {
      itemId: order.productId,
      type: "PRODUCTION_OUTPUT_REVERSAL",
      qtyDelta: -order.completedQty,
      valueDelta: -order.materialCost,
      date,
      sourceType: "PRODUCTION",
      sourceId: order.id,
      uniqueKey: `PRD:${order.id}:OUTPUT:REV`,
      notes: `${order.number} — ${reason}`,
    });
    for (const m of order.materials.filter((x) => x.actualQty > 0)) {
      await postMovement(tx, {
        itemId: m.materialId,
        type: "PRODUCTION_CONSUME_REVERSAL",
        qtyDelta: m.actualQty,
        valueDelta: m.totalCost,
        date,
        sourceType: "PRODUCTION",
        sourceId: order.id,
        uniqueKey: `PRD:${order.id}:CONSUME:${m.materialId}:REV`,
        notes: `${order.number} — ${reason}`,
      });
    }
    await audit(tx, "PRODUCTION_REVERSED", "ProductionOrder", order.id, { reason });
  });
}
