"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import {
  cancelProductionOrder,
  completeProductionOrder,
  createProductionOrder,
  reverseProductionOrder,
  updateProductionDraft,
} from "@/lib/services/production";

export const createOrderAction = ownerAction(async (fd) => {
  const order = await createProductionOrder(prisma, {
    productId: f.id(fd, "productId", "المنتج"),
    plannedQty: f.qty(fd, "plannedQty", "الكمية المخططة", { required: true }),
    date: f.date(fd, "date", "التاريخ"),
    notes: f.optText(fd, "notes"),
  });
  return `/production/${order.id}`;
});

export const updateOrderAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "أمر الإنتاج");
  await updateProductionDraft(prisma, id, {
    plannedQty: f.qty(fd, "plannedQty", "الكمية المخططة", { required: true }),
    completedQty: f.qty(fd, "completedQty", "الكمية المنجزة", { required: true }),
    date: f.date(fd, "date", "التاريخ"),
    notes: f.optText(fd, "notes"),
    materials: f.jsonField(fd, "materials", f.materialLinesSchema),
    recalculate: fd.get("intent") === "recalc",
  });
  return { message: fd.get("intent") === "recalc" ? "أُعيد حساب المواد من الوصفة" : "تم حفظ المسودة" };
});

export const completeOrderAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "أمر الإنتاج");
  await completeProductionOrder(prisma, id);
  return { message: "تم إكمال أمر الإنتاج: خُصمت المواد وأُضيف المنتج إلى المخزون" };
});

export const cancelOrderAction = ownerAction(async (fd) => {
  await cancelProductionOrder(prisma, f.id(fd, "id", "أمر الإنتاج"));
  return { message: "تم إلغاء أمر الإنتاج" };
});

export const reverseOrderAction = ownerAction(async (fd) => {
  await reverseProductionOrder(prisma, f.id(fd, "id", "أمر الإنتاج"), f.text(fd, "reason", "السبب"));
  return { message: "تم عكس أمر الإنتاج بحركات مخزون عكسية" };
});
