import type { PrismaClient } from "@prisma/client";
import { sum } from "../money";
import { diffLocalDays } from "../dates";
import { EMP_SIGN } from "./employees";

export type DebtRow = {
  kind: "CUSTOMER" | "SUPPLIER" | "EXPENSE" | "EMPLOYEE";
  docType: string;
  docId: number;
  docNumber: string;
  partyId: number | null;
  partyName: string;
  date: Date;
  dueDate: Date | null;
  amount: number;
  paid: number;
  remaining: number;
  overdueDays: number;
  link: string;
};

function overdue(due: Date | null, now: Date) {
  if (!due) return 0;
  const d = diffLocalDays(due, now);
  return d > 0 ? d : 0;
}

/**
 * الديون كما في لحظة `asOf` (افتراضياً الآن)، محسوبة من المستندات المُرحّلة والدفعات المُرحّلة فقط.
 * المسودات والمستندات الملغاة لا تدخل أبداً.
 */
export async function computeDebts(db: PrismaClient, asOf: Date = new Date(), now: Date = new Date()) {
  const [sales, purchases, expenses] = await Promise.all([
    db.sale.findMany({
      where: { status: "POSTED", date: { lt: asOf } },
      include: {
        customer: true,
        returns: { where: { status: "POSTED", date: { lt: asOf } } },
        allocations: { where: { payment: { status: "POSTED", date: { lt: asOf } } }, include: { payment: true } },
      },
    }),
    db.purchase.findMany({
      where: { status: "POSTED", date: { lt: asOf } },
      include: { supplier: true, allocations: { where: { payment: { status: "POSTED", date: { lt: asOf } } } } },
    }),
    db.expense.findMany({
      where: { status: "POSTED", paidByEmployeeId: null, date: { lt: asOf } },
      include: { category: true, allocations: { where: { payment: { status: "POSTED", date: { lt: asOf } } } } },
    }),
  ]);

  const customer: DebtRow[] = [];
  for (const s of sales) {
    const returns = sum(s.returns.map((r) => r.total));
    const paid = sum(s.allocations.map((a) => (a.payment.direction === "IN" ? a.amount : -a.amount)));
    const amount = s.total - returns;
    const remaining = amount - paid;
    if (remaining !== 0) {
      customer.push({
        kind: "CUSTOMER", docType: "SALE", docId: s.id, docNumber: s.number,
        partyId: s.customerId, partyName: s.customer?.name ?? "زبون نقدي",
        date: s.date, dueDate: s.dueDate, amount, paid, remaining,
        overdueDays: remaining > 0 ? overdue(s.dueDate, now) : 0, link: `/sales/${s.id}`,
      });
    }
  }
  const supplier: DebtRow[] = [];
  for (const p of purchases) {
    const paid = sum(p.allocations.map((a) => a.amount));
    const remaining = p.total - paid;
    if (remaining !== 0) {
      supplier.push({
        kind: "SUPPLIER", docType: "PURCHASE", docId: p.id, docNumber: p.number,
        partyId: p.supplierId, partyName: p.supplier.name,
        date: p.date, dueDate: p.dueDate, amount: p.total, paid, remaining,
        overdueDays: remaining > 0 ? overdue(p.dueDate, now) : 0, link: `/purchases/${p.id}`,
      });
    }
  }
  const unpaidExpenses: DebtRow[] = [];
  for (const e of expenses) {
    const paid = sum(e.allocations.map((a) => a.amount));
    const remaining = e.amount - paid;
    if (remaining > 0) {
      unpaidExpenses.push({
        kind: "EXPENSE", docType: "EXPENSE", docId: e.id, docNumber: e.number,
        partyId: null, partyName: e.category.name,
        date: e.date, dueDate: e.dueDate, amount: e.amount, paid, remaining,
        overdueDays: overdue(e.dueDate, now), link: `/expenses/${e.id}`,
      });
    }
  }

  const empTxns = await db.employeeTransaction.findMany({
    where: { status: "POSTED", date: { lt: asOf } },
    include: { employee: true },
  });
  const byEmp = new Map<number, { name: string; balance: number; advances: number }>();
  for (const t of empTxns) {
    const cur = byEmp.get(t.employeeId) ?? { name: t.employee.name, balance: 0, advances: 0 };
    cur.balance += EMP_SIGN[t.type] * t.amount;
    if (t.type === "ADVANCE") cur.advances += t.amount;
    if (t.type === "ADVANCE_REPAYMENT") cur.advances -= t.amount;
    byEmp.set(t.employeeId, cur);
  }
  const employees = [...byEmp.entries()]
    .filter(([, v]) => v.balance !== 0)
    .map(([id, v]) => ({ employeeId: id, name: v.name, balance: v.balance, advances: v.advances, link: `/employees/${id}` }));

  const customerTotal = sum(customer.filter((d) => d.remaining > 0).map((d) => d.remaining));
  const customerCredit = -sum(customer.filter((d) => d.remaining < 0).map((d) => d.remaining));
  const supplierTotal = sum(supplier.filter((d) => d.remaining > 0).map((d) => d.remaining));
  return {
    customer,
    supplier,
    unpaidExpenses,
    employees,
    totals: {
      customer: customerTotal,
      customerCredit,
      supplier: supplierTotal,
      expenses: sum(unpaidExpenses.map((d) => d.remaining)),
      employeesOwedByCompany: sum(employees.filter((e) => e.balance > 0).map((e) => e.balance)),
      employeesOwingCompany: -sum(employees.filter((e) => e.balance < 0).map((e) => e.balance)),
    },
  };
}
