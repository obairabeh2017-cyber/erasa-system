import type { PrismaClient } from "@prisma/client";
import { sum } from "../money";
import { monthRange } from "../dates";
import { computeDebts } from "./debts";
import { accountBalances } from "./payments";
import { stockAsOf } from "./inventory";
import { ACCRUAL_TYPES } from "./employees";

export type Report = Awaited<ReturnType<typeof computeReport>>;

/**
 * تقرير لفترة [start, end) محسوب بالكامل من المستندات والحركات الأصلية.
 * - المبيعات ≠ المقبوضات، والمشتريات ≠ المصروفات، وقيمة المخزون ≠ تكلفة المواد المستهلكة.
 * - «إجمالي الربح التقديري» = صافي المبيعات − تكلفة المواد للمبيعات (المواد الخام فقط).
 *   ليس صافي ربح مدققاً لأن تكلفة العمالة والتكاليف غير المباشرة غير محمّلة على المنتج.
 */
export async function computeReport(db: PrismaClient, start: Date, end: Date, now: Date = new Date()) {
  const inRange = { gte: start, lt: end };

  // ----- المبيعات -----
  const [salesPosted, salesDraft, salesVoided, returns] = await Promise.all([
    db.sale.findMany({ where: { status: "POSTED", date: inRange }, select: { subtotal: true, total: true, costTotal: true } }),
    db.sale.count({ where: { status: "DRAFT", date: inRange } }),
    db.sale.count({ where: { status: "VOIDED", date: inRange } }),
    db.saleReturn.findMany({ where: { status: "POSTED", date: inRange }, select: { total: true, costTotal: true } }),
  ]);
  const grossSales = sum(salesPosted.map((s) => s.subtotal));
  const salesTotal = sum(salesPosted.map((s) => s.total));
  const salesDiscounts = grossSales - salesTotal;
  const returnsTotal = sum(returns.map((r) => r.total));
  const netSales = salesTotal - returnsTotal;
  const cogs = sum(salesPosted.map((s) => s.costTotal)) - sum(returns.map((r) => r.costTotal));
  const grossProfit = netSales - cogs;

  // ----- النقدية (المقبوضات والمدفوعات الفعلية، بدون التحويلات الداخلية) -----
  const payments = await db.payment.groupBy({
    by: ["direction", "kind"],
    where: { status: "POSTED", date: inRange, kind: { not: "TRANSFER" } },
    _sum: { amount: true },
  });
  const pay = (direction: string, kinds?: string[]) =>
    sum(payments.filter((p) => p.direction === direction && (!kinds || kinds.includes(p.kind))).map((p) => p._sum.amount ?? 0));
  const receipts = {
    total: pay("IN"),
    fromCustomers: pay("IN", ["SALE_RECEIPT", "CUSTOMER_PAYMENT"]),
    otherIncome: pay("IN", ["OTHER_INCOME"]),
    employees: pay("IN", ["EMPLOYEE"]),
  };
  const disbursements = {
    total: pay("OUT"),
    suppliers: pay("OUT", ["PURCHASE_PAYMENT", "SUPPLIER_PAYMENT"]),
    expenses: pay("OUT", ["EXPENSE_PAYMENT"]),
    employees: pay("OUT", ["EMPLOYEE"]),
    refunds: pay("OUT", ["SALE_REFUND"]),
  };

  // ----- المشتريات -----
  const [purchasesPosted, purchasesDraft, purchasesVoided] = await Promise.all([
    db.purchase.findMany({ where: { status: "POSTED", date: inRange }, select: { subtotal: true, total: true } }),
    db.purchase.count({ where: { status: "DRAFT", date: inRange } }),
    db.purchase.count({ where: { status: "VOIDED", date: inRange } }),
  ]);
  const purchasesTotal = sum(purchasesPosted.map((p) => p.total));
  const purchasesDiscounts = sum(purchasesPosted.map((p) => p.subtotal)) - purchasesTotal;

  // ----- الإنتاج واستهلاك المواد -----
  const consumption = await db.stockMovement.aggregate({
    where: { date: inRange, type: { in: ["PRODUCTION_CONSUME", "PRODUCTION_CONSUME_REVERSAL"] } },
    _sum: { valueDelta: true },
  });
  const materialConsumptionCost = -(consumption._sum.valueDelta ?? 0);
  const orders = await db.productionOrder.findMany({
    where: { status: "COMPLETED", date: inRange },
    include: { product: { include: { unit: true } } },
  });
  const productionMap = new Map<number, { name: string; unit: string; qty: number; cost: number; orders: number }>();
  for (const o of orders) {
    const cur = productionMap.get(o.productId) ?? { name: o.product.name, unit: o.product.unit.name, qty: 0, cost: 0, orders: 0 };
    cur.qty += o.completedQty;
    cur.cost += o.materialCost;
    cur.orders += 1;
    productionMap.set(o.productId, cur);
  }
  const production = [...productionMap.values()];

  // ----- المصروفات -----
  const [expensesPosted, expensesVoided] = await Promise.all([
    db.expense.findMany({ where: { status: "POSTED", date: inRange }, include: { category: true } }),
    db.expense.count({ where: { status: "VOIDED", date: inRange } }),
  ]);
  const expByCat = new Map<string, number>();
  for (const e of expensesPosted) expByCat.set(e.category.name, (expByCat.get(e.category.name) ?? 0) + e.amount);
  const operatingExpenses = sum(expensesPosted.map((e) => e.amount));

  const empTxns = await db.employeeTransaction.findMany({
    where: { status: "POSTED", date: inRange, type: { in: ACCRUAL_TYPES } },
  });
  const salaryExpenses = sum(empTxns.map((t) => (t.type === "DEDUCTION" ? -t.amount : t.amount)));

  const otherIncomes = await db.otherIncome.findMany({ where: { status: "POSTED", date: inRange } });
  const otherIncomeTotal = sum(otherIncomes.map((o) => o.amount));

  // ----- الأرصدة في نهاية الفترة -----
  const asOf = end < now ? end : now;
  const debts = await computeDebts(db, end, asOf);
  const cash = await accountBalances(db, end);
  const stockMap = await stockAsOf(db, end);
  const items = await db.item.findMany({ include: { unit: true }, orderBy: { name: "asc" } });
  const stock = items
    .map((i) => ({
      id: i.id, sku: i.sku, name: i.name, type: i.type, unit: i.unit.name,
      minStock: i.minStock, qty: stockMap.get(i.id)?.qty ?? 0, value: stockMap.get(i.id)?.value ?? 0,
      currentQty: i.stockQty, active: i.active,
    }))
    .filter((i) => i.active || i.qty !== 0);
  const rawStock = stock.filter((s) => s.type === "RAW");
  const finishedStock = stock.filter((s) => s.type === "FINISHED");
  const lowStock = items.filter((i) => i.active && i.minStock > 0 && i.stockQty <= i.minStock);

  const estimatedOperatingResult = grossProfit + otherIncomeTotal - operatingExpenses - salaryExpenses;

  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    sales: {
      grossSales, discounts: salesDiscounts, total: salesTotal, returns: returnsTotal, net: netSales,
      count: salesPosted.length, excludedDrafts: salesDraft, excludedVoided: salesVoided,
    },
    cogs,
    grossProfit,
    receipts,
    disbursements,
    purchases: {
      total: purchasesTotal, discounts: purchasesDiscounts, count: purchasesPosted.length,
      excludedDrafts: purchasesDraft, excludedVoided: purchasesVoided,
    },
    materialConsumptionCost,
    production,
    expenses: {
      operating: operatingExpenses,
      byCategory: [...expByCat.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
      salaries: salaryExpenses,
      excludedVoided: expensesVoided,
    },
    otherIncome: otherIncomeTotal,
    estimatedOperatingResult,
    debts: {
      customer: debts.totals.customer,
      supplier: debts.totals.supplier,
      unpaidExpenses: debts.totals.expenses,
      overdue: [...debts.customer, ...debts.supplier]
        .filter((d) => d.overdueDays > 0 && d.remaining > 0)
        .map((d) => ({ kind: d.kind, docNumber: d.docNumber, partyName: d.partyName, remaining: d.remaining, overdueDays: d.overdueDays })),
    },
    cash: cash.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance })),
    cashTotal: sum(cash.map((a) => a.balance)),
    stock: {
      raw: rawStock,
      finished: finishedStock,
      rawValue: sum(rawStock.map((s) => s.value)),
      finishedValue: sum(finishedStock.map((s) => s.value)),
    },
    lowStock: lowStock.map((i) => ({ id: i.id, sku: i.sku, name: i.name, qty: i.stockQty, minStock: i.minStock, unit: i.unit.name })),
  };
}

export async function computeMonthlyReport(db: PrismaClient, period: string, now: Date = new Date()) {
  const { start, end } = monthRange(period);
  return computeReport(db, start, end, now);
}

/** يحفظ لقطة من التقرير الشهري (يمكن إعادة توليدها من الحركات في أي وقت). */
export async function saveMonthlyReport(db: PrismaClient, period: string, auto: boolean, now: Date = new Date()) {
  const data = await computeMonthlyReport(db, period, now);
  const json = JSON.stringify(data);
  return db.monthlyReport.upsert({
    where: { period },
    create: { period, data: json, auto, generatedAt: now },
    update: { data: json, auto, generatedAt: now },
  });
}

/** سلسلة شهرية للمبيعات والمصروفات للرسم البياني. */
export async function monthlySeries(db: PrismaClient, periods: string[]) {
  const out = [];
  for (const p of periods) {
    const { start, end } = monthRange(p);
    const inRange = { gte: start, lt: end };
    const [s, r, e, t] = await Promise.all([
      db.sale.aggregate({ where: { status: "POSTED", date: inRange }, _sum: { total: true } }),
      db.saleReturn.aggregate({ where: { status: "POSTED", date: inRange }, _sum: { total: true } }),
      db.expense.aggregate({ where: { status: "POSTED", date: inRange }, _sum: { amount: true } }),
      db.employeeTransaction.findMany({ where: { status: "POSTED", date: inRange, type: { in: ACCRUAL_TYPES } } }),
    ]);
    const salaries = sum(t.map((x) => (x.type === "DEDUCTION" ? -x.amount : x.amount)));
    out.push({
      period: p,
      sales: (s._sum.total ?? 0) - (r._sum.total ?? 0),
      expenses: (e._sum.amount ?? 0) + salaries,
    });
  }
  return out;
}
