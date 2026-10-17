"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { audit } from "@/lib/audit";
import { createPartyPayment } from "@/lib/services/payments";
import { BusinessError } from "@/lib/errors";

function partyData(fd: FormData) {
  return {
    name: f.text(fd, "name", "الاسم"),
    phone: f.optText(fd, "phone", 40),
    address: f.optText(fd, "address", 200),
    notes: f.optText(fd, "notes"),
  };
}

export const createCustomer = ownerAction(async (fd) => {
  const c = await prisma.customer.create({ data: partyData(fd) });
  await audit(prisma, "CUSTOMER_CREATED", "Customer", c.id);
  return `/customers/${c.id}`;
});

export const updateCustomer = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الزبون");
  await prisma.customer.update({ where: { id }, data: { ...partyData(fd), active: f.bool(fd, "active") } });
  await audit(prisma, "CUSTOMER_UPDATED", "Customer", id);
  return { message: "تم الحفظ" };
});

export const createSupplier = ownerAction(async (fd) => {
  const s = await prisma.supplier.create({ data: partyData(fd) });
  await audit(prisma, "SUPPLIER_CREATED", "Supplier", s.id);
  return `/suppliers/${s.id}`;
});

export const updateSupplier = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "المورّد");
  await prisma.supplier.update({ where: { id }, data: { ...partyData(fd), active: f.bool(fd, "active") } });
  await audit(prisma, "SUPPLIER_UPDATED", "Supplier", id);
  return { message: "تم الحفظ" };
});

/** دفعة على الحساب من زبون أو إلى مورّد، مع توزيع تلقائي على أقدم الفواتير. */
export const partyPaymentAction = ownerAction(async (fd) => {
  const kind = f.oneOf(fd, "partyKind", ["customer", "supplier"] as const, "نوع الطرف");
  const partyId = f.id(fd, "partyId", "الطرف");
  const amount = f.money(fd, "payAmount", "المبلغ", { required: true });
  if (amount <= 0) throw new BusinessError("أدخل مبلغاً أكبر من صفر");
  await createPartyPayment(prisma, {
    party: kind === "customer" ? { customerId: partyId } : { supplierId: partyId },
    accountId: f.id(fd, "accountId", "الحساب"),
    amount,
    date: f.date(fd, "date", "التاريخ"),
    method: f.optText(fd, "method") ?? "CASH",
    reference: f.optText(fd, "reference"),
    notes: f.optText(fd, "notes"),
    autoAllocate: f.bool(fd, "autoAllocate"),
  });
  return { message: "تم تسجيل الدفعة" };
});
