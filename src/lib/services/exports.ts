import type { PrismaClient } from "@prisma/client";
import { formatMoney, formatQty, sum } from "../money";
import { dateRange, formatDate, isDateInput, toDateInput } from "../dates";
import { DOC_STATUS, EMP_TXN, ITEM_TYPE, MOVEMENT_TYPE, PAYMENT_KIND, PAYMENT_METHOD, DIRECTION, ACCOUNT_TYPE, label } from "../labels";
import { computeDebts } from "./debts";
import { computeReport } from "./reports";
import { accountBalances } from "./payments";

type Cell = string | number | null | undefined;
export type Dataset = { filename: string; headers: string[]; rows: Cell[][] };

/** CSV متوافق مع Excel: ترميز UTF-8 مع BOM حتى تظهر العربية صحيحة، وفواصل أسطر CRLF. */
export function toCsv(d: Dataset): string {
  const esc = (v: Cell) => {
    let s = v === null || v === undefined ? "" : String(v);
    // منع حقن الصيغ في Excel (نص يبدأ بـ = أو + أو @ أو - غير رقمي)
    if (/^[=+@]/.test(s) || (/^-/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [d.headers, ...d.rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

const m = (v: number) => formatMoney(v, false).replace(/,/g, "");
const q = (v: number) => formatQty(v).replace(/,/g, "");

export async function buildDataset(db: PrismaClient, entity: string, params: URLSearchParams): Promise<Dataset | null> {
  switch (entity) {
    case "items": {
      const rows = await db.item.findMany({ include: { unit: true, category: true }, orderBy: { sku: "asc" } });
      return {
        filename: "items",
        headers: ["الرمز", "الاسم", "النوع", "الفئة", "الوحدة", "الرصيد", "الحد الأدنى", "قيمة المخزون", "سعر البيع", "نشط"],
        rows: rows.map((i) => [i.sku, i.name, ITEM_TYPE[i.type], i.category?.name, i.unit.name, q(i.stockQty), q(i.minStock), m(i.stockValue), m(i.salePrice), i.active ? "نعم" : "لا"]),
      };
    }
    case "movements": {
      const itemId = Number(params.get("itemId")) || undefined;
      const rows = await db.stockMovement.findMany({ where: itemId ? { itemId } : {}, include: { item: true }, orderBy: [{ date: "asc" }, { id: "asc" }] });
      return {
        filename: "stock-movements",
        headers: ["التاريخ", "الرمز", "الصنف", "النوع", "الكمية", "القيمة", "الرصيد بعد", "المصدر", "رقم المصدر", "ملاحظات"],
        rows: rows.map((r) => [formatDate(r.date), r.item.sku, r.item.name, label(MOVEMENT_TYPE, r.type), q(r.qtyDelta), m(r.valueDelta), q(r.balanceAfter), r.sourceType, r.sourceId, r.notes]),
      };
    }
    case "sales": {
      const rows = await db.sale.findMany({ include: { customer: true, returns: { where: { status: "POSTED" } }, allocations: { where: { payment: { status: "POSTED" } }, include: { payment: true } } }, orderBy: { date: "asc" } });
      return {
        filename: "sales",
        headers: ["الرقم", "التاريخ", "الزبون", "الحالة", "قبل الخصم", "الخصومات", "الإجمالي", "المرتجعات", "المستلم", "المتبقي", "تكلفة المواد", "الاستحقاق"],
        rows: rows.map((s) => {
          const rec = sum(s.allocations.map((a) => (a.payment.direction === "IN" ? a.amount : -a.amount)));
          const ret = sum(s.returns.map((r) => r.total));
          return [s.number, formatDate(s.date), s.customer?.name ?? "زبون نقدي", label(DOC_STATUS, s.status), m(s.subtotal), m(s.subtotal - s.total), m(s.total), m(ret), m(rec), s.status === "POSTED" ? m(s.total - ret - rec) : "", m(s.costTotal), formatDate(s.dueDate)];
        }),
      };
    }
    case "sale-lines": {
      const rows = await db.saleItem.findMany({ include: { sale: true, item: true }, orderBy: { id: "asc" } });
      return {
        filename: "sale-lines",
        headers: ["الفاتورة", "التاريخ", "الحالة", "المنتج", "الكمية", "السعر", "الخصم", "الصافي", "تكلفة الوحدة", "تكلفة السطر"],
        rows: rows.map((l) => [l.sale.number, formatDate(l.sale.date), label(DOC_STATUS, l.sale.status), l.item.name, q(l.qty), m(l.unitPrice), m(l.lineDiscount), m(l.lineTotal), m(l.unitCost), m(l.costTotal)]),
      };
    }
    case "purchases": {
      const rows = await db.purchase.findMany({ include: { supplier: true, allocations: { where: { payment: { status: "POSTED" } } } }, orderBy: { date: "asc" } });
      return {
        filename: "purchases",
        headers: ["الرقم", "التاريخ", "المورّد", "فاتورة المورّد", "الحالة", "قبل الخصم", "الخصومات", "الإجمالي", "المدفوع", "المتبقي", "الاستحقاق"],
        rows: rows.map((p) => {
          const paid = sum(p.allocations.map((a) => a.amount));
          return [p.number, formatDate(p.date), p.supplier.name, p.supplierInvoiceNo, label(DOC_STATUS, p.status), m(p.subtotal), m(p.subtotal - p.total), m(p.total), m(paid), p.status === "POSTED" ? m(p.total - paid) : "", formatDate(p.dueDate)];
        }),
      };
    }
    case "purchase-lines": {
      const rows = await db.purchaseItem.findMany({ include: { purchase: true, item: true }, orderBy: { id: "asc" } });
      return {
        filename: "purchase-lines",
        headers: ["الفاتورة", "التاريخ", "الحالة", "الصنف", "الكمية", "تكلفة الوحدة", "الخصم", "الصافي", "قيمة المخزون"],
        rows: rows.map((l) => [l.purchase.number, formatDate(l.purchase.date), label(DOC_STATUS, l.purchase.status), l.item.name, q(l.qty), m(l.unitCost), m(l.lineDiscount), m(l.lineTotal), m(l.stockValue)]),
      };
    }
    case "production": {
      const rows = await db.productionOrder.findMany({ include: { product: true }, orderBy: { date: "asc" } });
      return {
        filename: "production-orders",
        headers: ["الرقم", "التاريخ", "المنتج", "المخطط", "المنجز", "الحالة", "تكلفة المواد", "تكلفة الوحدة"],
        rows: rows.map((o) => [o.number, formatDate(o.date), o.product.name, q(o.plannedQty), q(o.completedQty), label(DOC_STATUS, o.status), m(o.materialCost), m(o.unitCost)]),
      };
    }
    case "payments": {
      const rows = await db.payment.findMany({ include: { account: true, customer: true, supplier: true, employee: true }, orderBy: { date: "asc" } });
      return {
        filename: "payments",
        headers: ["الرقم", "التاريخ", "الاتجاه", "النوع", "الحساب", "الطريقة", "المرجع", "الطرف", "المبلغ", "الحالة", "ملاحظات"],
        rows: rows.map((p) => [p.number, formatDate(p.date), DIRECTION[p.direction], label(PAYMENT_KIND, p.kind), p.account.name, label(PAYMENT_METHOD, p.method), p.reference, p.customer?.name ?? p.supplier?.name ?? p.employee?.name, m(p.amount), p.status === "VOIDED" ? "ملغاة" : "مُرحّلة", p.notes]),
      };
    }
    case "expenses": {
      const rows = await db.expense.findMany({ include: { category: true, paidByEmployee: true, allocations: { where: { payment: { status: "POSTED" } } } }, orderBy: { date: "asc" } });
      return {
        filename: "expenses",
        headers: ["الرقم", "التاريخ", "الفئة", "الوصف", "المبلغ", "المسدد", "دفعه موظف", "الحالة"],
        rows: rows.map((e) => [e.number, formatDate(e.date), e.category.name, e.description, m(e.amount), m(sum(e.allocations.map((a) => a.amount))), e.paidByEmployee?.name, label(DOC_STATUS, e.status)]),
      };
    }
    case "other-income": {
      const rows = await db.otherIncome.findMany({ include: { category: true }, orderBy: { date: "asc" } });
      return { filename: "other-income", headers: ["الرقم", "التاريخ", "الفئة", "الوصف", "المبلغ", "الحالة"], rows: rows.map((e) => [e.number, formatDate(e.date), e.category?.name, e.description, m(e.amount), label(DOC_STATUS, e.status)]) };
    }
    case "customers":
    case "suppliers": {
      const rows = entity === "customers" ? await db.customer.findMany({ orderBy: { name: "asc" } }) : await db.supplier.findMany({ orderBy: { name: "asc" } });
      return { filename: entity, headers: ["الرقم", "الاسم", "الهاتف", "العنوان", "ملاحظات", "نشط"], rows: rows.map((c) => [c.id, c.name, c.phone, c.address, c.notes, c.active ? "نعم" : "لا"]) };
    }
    case "employees": {
      const rows = await db.employee.findMany({ orderBy: { code: "asc" } });
      return { filename: "employees", headers: ["الرمز", "الاسم", "الهاتف", "الوظيفة", "الراتب الأساسي", "تاريخ البدء", "نشط"], rows: rows.map((e) => [e.code, e.name, e.phone, e.jobTitle, m(e.baseSalary), formatDate(e.startDate), e.active ? "نعم" : "لا"]) };
    }
    case "employee-transactions": {
      const employeeId = Number(params.get("employeeId")) || undefined;
      const rows = await db.employeeTransaction.findMany({ where: employeeId ? { employeeId } : {}, include: { employee: true }, orderBy: { date: "asc" } });
      return { filename: "employee-transactions", headers: ["التاريخ", "الموظف", "النوع", "الشهر", "البيان", "المبلغ", "الحالة"], rows: rows.map((t) => [formatDate(t.date), t.employee.name, label(EMP_TXN, t.type), t.period, t.description, m(t.amount), t.status === "VOIDED" ? "ملغاة" : "مُرحّلة"]) };
    }
    case "debts": {
      const d = await computeDebts(db);
      const rows = [...d.customer, ...d.supplier, ...d.unpaidExpenses];
      return {
        filename: "debts",
        headers: ["النوع", "المستند", "الطرف", "التاريخ", "الاستحقاق", "المبلغ", "المدفوع", "المتبقي", "أيام التأخير"],
        rows: rows.map((r) => [r.kind === "CUSTOMER" ? "زبون" : r.kind === "SUPPLIER" ? "مورّد" : "مصروف", r.docNumber, r.partyName, formatDate(r.date), formatDate(r.dueDate), m(r.amount), m(r.paid), m(r.remaining), r.overdueDays]),
      };
    }
    case "accounts": {
      const rows = await accountBalances(db);
      return { filename: "cash-accounts", headers: ["الحساب", "النوع", "الرصيد الافتتاحي", "المقبوضات", "المدفوعات", "الرصيد"], rows: rows.map((a) => [a.name, ACCOUNT_TYPE[a.type], m(a.openingBalance), m(a.totalIn), m(a.totalOut), m(a.balance)]) };
    }
    case "report": {
      const from = params.get("from") ?? "";
      const to = params.get("to") ?? "";
      if (!isDateInput(from) || !isDateInput(to)) return null;
      const { start, end } = dateRange(from, to);
      const r = await computeReport(db, start, end);
      const rows: Cell[][] = [
        ["المبيعات قبل الخصم", m(r.sales.grossSales)], ["خصومات المبيعات", m(r.sales.discounts)], ["المبيعات المُرحّلة", m(r.sales.total)],
        ["المرتجعات", m(r.sales.returns)], ["صافي المبيعات", m(r.sales.net)], ["تكلفة المواد للمبيعات", m(r.cogs)],
        ["إجمالي الربح التقديري (مواد خام فقط)", m(r.grossProfit)], ["إيرادات أخرى", m(r.otherIncome)], ["المصروفات التشغيلية", m(r.expenses.operating)],
        ["مصروف الرواتب", m(r.expenses.salaries)], ["النتيجة التشغيلية التقديرية (غير مدققة)", m(r.estimatedOperatingResult)],
        ["إجمالي المقبوضات", m(r.receipts.total)], ["مقبوضات الزبائن", m(r.receipts.fromCustomers)], ["إجمالي المدفوعات", m(r.disbursements.total)],
        ["مشتريات المواد", m(r.purchases.total)], ["تكلفة المواد المستهلكة في الإنتاج", m(r.materialConsumptionCost)],
        ["ديون الزبائن في نهاية الفترة", m(r.debts.customer)], ["ديون الموردين في نهاية الفترة", m(r.debts.supplier)], ["إجمالي النقدية", m(r.cashTotal)],
        ["قيمة مخزون المواد الخام", m(r.stock.rawValue)], ["قيمة مخزون المنتجات التامة", m(r.stock.finishedValue)],
        ["فواتير بيع مستبعدة (مسودة/ملغاة)", `${r.sales.excludedDrafts}/${r.sales.excludedVoided}`],
      ];
      return { filename: `report-${from}-to-${to}`, headers: ["البند", "القيمة (د.ل)"], rows };
    }
    default:
      return null;
  }
}

export function exportFilename(base: string): string {
  return `${base}-${toDateInput()}.csv`;
}
