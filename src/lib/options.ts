import { prisma } from "./db";
import type { LineOption } from "@/components/lines-editor";

export async function itemOptions(type?: "RAW" | "FINISHED", opts: { includeStock?: boolean; priceFrom?: "sale" | "cost" } = {}): Promise<LineOption[]> {
  const items = await prisma.item.findMany({
    where: { active: true, ...(type ? { type } : {}) },
    include: { unit: true },
    orderBy: { name: "asc" },
  });
  return items.map((i) => ({
    id: i.id,
    label: `${i.name} — ${i.sku}`,
    unit: i.unit.name,
    price: opts.priceFrom === "sale" ? i.salePrice : opts.priceFrom === "cost" && i.stockQty > 0 ? Math.round((i.stockValue * 1000) / i.stockQty) : undefined,
    stock: opts.includeStock ? i.stockQty : undefined,
  }));
}

export const accountOptions = () => prisma.cashAccount.findMany({ where: { active: true }, orderBy: { id: "asc" } });
export const customerOptions = () => prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } });
export const supplierOptions = () => prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } });
export const employeeOptions = () => prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } });
export const categoryOptions = (kind: "ITEM" | "EXPENSE" | "INCOME") => prisma.category.findMany({ where: { kind }, orderBy: { name: "asc" } });
export const unitOptions = () => prisma.unit.findMany({ orderBy: { name: "asc" } });
