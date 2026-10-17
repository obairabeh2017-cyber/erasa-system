"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { audit } from "@/lib/audit";
import { recordAdjustment, recordOpeningBalance } from "@/lib/services/inventory";
import { BusinessError } from "@/lib/errors";

function itemData(fd: FormData) {
  return {
    sku: f.text(fd, "sku", "رمز الصنف", 40),
    name: f.text(fd, "name", "اسم الصنف"),
    type: f.oneOf(fd, "type", ["RAW", "FINISHED"] as const, "نوع الصنف"),
    categoryId: f.optId(fd, "categoryId"),
    unitId: f.id(fd, "unitId", "وحدة القياس"),
    minStock: f.qty(fd, "minStock", "الحد الأدنى"),
    salePrice: f.money(fd, "salePrice", "سعر البيع"),
    notes: f.optText(fd, "notes"),
  };
}

export const createItem = ownerAction(async (fd) => {
  const data = itemData(fd);
  // التحقق من حقول الرصيد الافتتاحي قبل إنشاء الصنف
  const openingQty = f.qty(fd, "openingQty", "الرصيد الافتتاحي");
  const opening =
    openingQty > 0
      ? { qty: openingQty, unitCost: f.money(fd, "openingCost", "تكلفة الوحدة الافتتاحية"), date: f.date(fd, "openingDate", "تاريخ الرصيد الافتتاحي") }
      : null;
  const item = await prisma.item.create({ data });
  await audit(prisma, "ITEM_CREATED", "Item", item.id, { sku: item.sku });
  if (opening) await recordOpeningBalance(prisma, { itemId: item.id, ...opening });
  return `/items/${item.id}`;
});

export const updateItem = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الصنف");
  const data = itemData(fd);
  const existing = await prisma.item.findUniqueOrThrow({ where: { id } });
  if (existing.type !== data.type) {
    const used = await prisma.stockMovement.count({ where: { itemId: id } });
    if (used > 0) throw new BusinessError("لا يمكن تغيير نوع صنف له حركات مخزون");
  }
  await prisma.item.update({ where: { id }, data: { ...data, active: f.bool(fd, "active") } });
  await audit(prisma, "ITEM_UPDATED", "Item", id, data);
  return { message: "تم حفظ بيانات الصنف" };
});

export const openingBalance = ownerAction(async (fd) => {
  await recordOpeningBalance(prisma, {
    itemId: f.id(fd, "id", "الصنف"),
    qty: f.qty(fd, "qty", "الكمية", { required: true }),
    unitCost: f.money(fd, "unitCost", "تكلفة الوحدة"),
    date: f.date(fd, "date", "التاريخ"),
    notes: f.optText(fd, "notes"),
  });
  return { message: "تم تسجيل الرصيد الافتتاحي" };
});

export const adjustStock = ownerAction(async (fd) => {
  const direction = f.oneOf(fd, "direction", ["IN", "OUT"] as const, "نوع التسوية");
  const q = f.qty(fd, "qty", "الكمية", { required: true });
  const cost = (fd.get("unitCost") as string | null)?.trim();
  await recordAdjustment(prisma, {
    itemId: f.id(fd, "id", "الصنف"),
    qtyDelta: direction === "IN" ? q : -q,
    unitCost: cost ? f.money(fd, "unitCost", "تكلفة الوحدة") : null,
    date: f.date(fd, "date", "التاريخ"),
    reason: f.text(fd, "reason", "سبب التسوية"),
  });
  return { message: "تم تسجيل التسوية" };
});
