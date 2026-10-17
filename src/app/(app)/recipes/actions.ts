"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { saveRecipe } from "@/lib/services/production";

export const saveRecipeAction = ownerAction(async (fd) => {
  const productId = f.id(fd, "productId", "المنتج");
  const lines = f.jsonField(fd, "lines", f.recipeLinesSchema);
  await saveRecipe(prisma, {
    productId,
    outputQty: f.qty(fd, "outputQty", "كمية الإنتاج", { required: true }),
    notes: f.optText(fd, "notes"),
    lines: lines.map((l) => ({ materialId: l.materialId, qty: l.qty, wasteBp: f.percentBp(l.waste) })),
  });
  return { message: "تم حفظ نسخة جديدة من الوصفة" };
});
